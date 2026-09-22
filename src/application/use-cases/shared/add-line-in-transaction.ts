import { Invoice, InvoiceLine, LineTax } from '../../../domain/entities.js';
import { BadRequestError, ProductDisabledError, ProductNotFoundError } from '../../../domain/errors.js';
import { ProductCatalogPort, TaxRatePort } from '../../ports.js';
import { AddLineInput, InvoiceDetailDTO } from '../../dts.js';
import { invoiceToDetailDTO } from '../create-invoice.js';
import { moneyToCents, moneyFromDecimalString, addCents } from '../../../domain/value-objects.js';
import { recomputeAndSaveTaxTotals } from './recompute-tax-totals.js';
import type { BusinessRepositories } from '../../../domain/repositories.js';

/**
 * Cuerpo compartido de "añadir una línea a un borrador": valida, resuelve el
 * producto y sus impuestos, guarda la línea y deja la factura con los totales
 * al día. Lo usan AddLineUseCase (una línea, desde el CRM) y la ingesta de
 * ventas del POS (todas las líneas de la venta, en la misma transacción).
 * Trabaja sobre `repos` ya transaccionales; el evento de dominio y la respuesta
 * los decide cada caso de uso.
 */
export async function addLineInTransaction(
  repos: BusinessRepositories,
  invoice: Invoice,
  input: AddLineInput,
  deps: { productCatalog: ProductCatalogPort; taxRateCatalog: TaxRatePort },
): Promise<InvoiceDetailDTO> {
  const organizationId = invoice.organizationId;
  const invoiceId = invoice.id;

  if (input.quantity <= 0) throw new BadRequestError('La cantidad debe ser mayor que cero');

  const unitPriceCents = moneyToCents(moneyFromDecimalString(input.unitPrice, invoice.currencyCode));
  if (unitPriceCents <= 0) throw new BadRequestError('El precio unitario debe ser mayor que cero');

  if ((input.discountCents ?? 0) > input.quantity * unitPriceCents) {
    throw new BadRequestError('El descuento no puede ser mayor al subtotal de la línea');
  }

  const productInfo = await deps.productCatalog.findById(organizationId, input.productId);

  // `null` ⇒ product-service respondió 404: el producto no existe.
  // (Si el catálogo está caído el port LANZA ProductCatalogError/503.)
  if (!productInfo) throw new ProductNotFoundError();
  if (productInfo.status !== 'active') throw new ProductDisabledError();

  const rateInfos = await Promise.all(
    productInfo.taxes.map((pt) => deps.taxRateCatalog.findRate(invoice.countryCode, pt.taxRateId)),
  );
  const rates = rateInfos.map((ri) => (ri ? parseFloat(ri.percentage) : 0));

  // La línea guarda SIEMPRE importes sin impuestos: precio unitario,
  // descuento y subtotal son la base, y el impuesto va aparte. Es lo que
  // declara el SRI (precioUnitario, precioTotalSinImpuesto) y lo que asume
  // el total de la factura (subtotal + impuestos).
  //
  // Antes, con precio con IVA incluido, la línea guardaba el importe CON IVA
  // como subtotal y el total volvía a sumarle el IVA: 10 × $11,50 salía a
  // $130 en vez de $115. Ahora el IVA se quita del precio y del descuento
  // primero, y se calcula una sola vez sobre la base. Puede haber un
  // centavo de diferencia con el precio de góndola por redondeo, pero la
  // factura cuadra siempre (base × tarifa = impuesto).
  const includedRatePercent = productInfo.priceIncludesTax ? rates.reduce((sum, r) => sum + r, 0) : 0;
  const withoutTax = (cents: number) => Math.round(cents / (1 + includedRatePercent / 100));
  const netUnitPriceCents = withoutTax(unitPriceCents);
  const netDiscountCents = withoutTax(input.discountCents ?? 0);
  const lineSubtotalCents = Math.round(input.quantity * netUnitPriceCents) - netDiscountCents;

  const line = InvoiceLine.create({
    invoiceId,
    productId: input.productId,
    productSnapshot: { id: productInfo.id, name: productInfo.name, sku: productInfo.sku, unit: productInfo.unit },
    // Sin descripción vale el nombre del catálogo: una línea de factura en
    // blanco no le dice nada a quien la recibe (la ingesta del POS puede no mandarla).
    description: input.description || productInfo.name,
    quantity: input.quantity,
    unitPriceCents: netUnitPriceCents,
    discountCents: netDiscountCents,
    subtotalCents: lineSubtotalCents,
  });

  await repos.invoiceLines.save(line);

  // ── Impuestos: uno por cada tasa asignada al producto, sobre la base ──
  const newLineTaxes: LineTax[] = [];
  for (let i = 0; i < productInfo.taxes.length; i++) {
    const productTax = productInfo.taxes[i];
    const rateInfo = rateInfos[i];
    const lt = LineTax.create({
      invoiceLineId: line.id,
      taxRateId: productTax.taxRateId,
      kind: productTax.kind as 'vat' | 'withholding_iva' | 'withholding_rent' | 'special',
      rateSnapshot: rateInfo ? rateInfo.percentage : '0',
      baseCents: lineSubtotalCents,
      amountCents: Math.round(lineSubtotalCents * (rates[i] / 100)),
    });
    await repos.lineTaxes.save(lt);
    newLineTaxes.push(lt);
  }

  const existingTaxes = await repos.lineTaxes.findByInvoice(invoiceId);
  const allLineTaxes = [...existingTaxes.filter((t) => t.invoiceLineId !== line.id), ...newLineTaxes];

  const invoiceLines = await repos.invoiceLines.findByInvoice(invoiceId);
  let newSubtotal = 0;
  let newTaxTotal = 0;
  for (const l of invoiceLines) {
    newSubtotal = addCents(newSubtotal, l.subtotalCents);
  }
  for (const t of allLineTaxes) {
    newTaxTotal = addCents(newTaxTotal, t.amountCents);
  }
  const newTotal = addCents(newSubtotal, newTaxTotal);

  invoice.updateTotals(newSubtotal, newTaxTotal, newTotal);
  await repos.invoices.save(invoice);

  await recomputeAndSaveTaxTotals(invoiceId, allLineTaxes, repos);

  const taxTotals = await repos.invoiceTaxTotals.findByInvoice(invoiceId);
  const linesDTO = invoiceLines.map((l) => ({
    id: l.id, productId: l.productId, productSnapshot: l.productSnapshot, description: l.description,
    quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents,
    subtotalCents: l.subtotalCents, taxes: [] as never[],
  }));
  const lineTaxDTOs = allLineTaxes.map((t) => ({ id: t.id, invoiceLineId: t.invoiceLineId, taxRateId: t.taxRateId, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));
  const taxTotalDTOs = taxTotals.map((t) => ({ id: t.id, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));

  return invoiceToDetailDTO(invoice, linesDTO, lineTaxDTOs, taxTotalDTOs);
}
