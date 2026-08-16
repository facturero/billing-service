import { InvoiceLine, LineTax } from '../../domain/entities.js';
import { InvoiceNotFoundError, BadRequestError, ProductDisabledError } from '../../domain/errors.js';
import { UnitOfWork, ProductCatalogPort, TaxRatePort } from '../ports.js';
import { AddLineInput, InvoiceDetailDTO, InvoiceLineDTO } from '../dts.js';
import { invoiceToDetailDTO } from './create-invoice.js';
import { moneyToCents, moneyFromDecimalString, addCents } from '../../domain/value-objects.js';
import { recomputeAndSaveTaxTotals } from './shared/recompute-tax-totals.js';

export class AddLineUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly productCatalog: ProductCatalogPort,
    private readonly taxRateCatalog: TaxRatePort,
  ) {}

  async execute(
    organizationId: string,
    invoiceId: string,
    input: AddLineInput,
  ): Promise<InvoiceDetailDTO> {
    return this.uow.execute(async (repos) => {
      const invoice = await repos.business.invoices.findByIdAndOrganization(invoiceId, organizationId);
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.status !== 'draft') throw new BadRequestError('Solo se pueden modificar borradores');

      if (input.quantity <= 0) throw new BadRequestError('La cantidad debe ser mayor que cero');

      const unitPriceCents = moneyToCents(moneyFromDecimalString(input.unitPrice, invoice.currencyCode));
      if (unitPriceCents <= 0) throw new BadRequestError('El precio unitario debe ser mayor que cero');

      if ((input.discountCents ?? 0) > input.quantity * unitPriceCents) {
        throw new BadRequestError('El descuento no puede ser mayor al subtotal de la línea');
      }

      const lineSubtotalCents = (input.quantity * unitPriceCents) - (input.discountCents ?? 0);

      const productInfo = await this.productCatalog.findById(organizationId, input.productId);
      console.log(`[billing][add-line] productInfo para ${input.productId}:`, JSON.stringify(productInfo));

      if (productInfo && productInfo.status !== 'active') throw new ProductDisabledError();

      const line = InvoiceLine.create({
        invoiceId,
        productId: input.productId,
        productSnapshot: productInfo
          ? { id: productInfo.id, name: productInfo.name, sku: productInfo.sku, unit: productInfo.unit }
          : undefined,
        description: input.description,
        quantity: input.quantity,
        unitPriceCents,
        discountCents: input.discountCents ?? 0,
        subtotalCents: lineSubtotalCents,
      });

      await repos.business.invoiceLines.save(line);

      // ── Impuestos: uno por cada tasa asignada al producto (IVA, retenciones, etc.) ──
      const newLineTaxes: LineTax[] = [];
      console.log(`[billing][add-line] productInfo?.taxes:`, JSON.stringify(productInfo?.taxes ?? []));

      // Pre-fetch all rate info
      const rateInfos = await Promise.all(
        (productInfo?.taxes ?? []).map((pt) =>
          this.taxRateCatalog.findRate(invoice.countryCode, pt.taxRateId),
        ),
      );

      if (productInfo?.priceIncludesTax && productInfo.taxes.length > 1) {
        // Multi-tax with priceIncludesTax: extract combined base once, distribute proportionally
        const totalRatePercent = rateInfos.reduce((sum, ri) => sum + (ri ? parseFloat(ri.percentage) : 0), 0);
        const baseCents = Math.round(lineSubtotalCents / (1 + totalRatePercent / 100));
        const totalTaxAmount = lineSubtotalCents - baseCents;

        for (let i = 0; i < productInfo.taxes.length; i++) {
          const productTax = productInfo.taxes[i];
          const rateInfo = rateInfos[i];
          const ratePercent = rateInfo ? parseFloat(rateInfo.percentage) : 0;
          const amountCents = totalRatePercent > 0
            ? Math.round(totalTaxAmount * (ratePercent / totalRatePercent))
            : 0;

          console.log(`[billing][add-line] multi-tax: ratePercent=${ratePercent} baseCents=${baseCents} amountCents=${amountCents}`);

          const lt = LineTax.create({
            invoiceLineId: line.id,
            taxRateId: productTax.taxRateId,
            kind: productTax.kind as 'vat' | 'withholding_iva' | 'withholding_rent' | 'special',
            rateSnapshot: rateInfo ? rateInfo.percentage : '0',
            baseCents,
            amountCents,
          });
          await repos.business.lineTaxes.save(lt);
          newLineTaxes.push(lt);
        }
      } else {
        // Single tax or no priceIncludesTax: each tax calculated independently
        for (let i = 0; i < (productInfo?.taxes ?? []).length; i++) {
          const productTax = productInfo!.taxes[i];
          const rateInfo = rateInfos[i];
          const ratePercent = rateInfo ? parseFloat(rateInfo.percentage) : 0;

          let baseCents = lineSubtotalCents;
          let amountCents = 0;
          if (productInfo?.priceIncludesTax) {
            baseCents = Math.round(lineSubtotalCents / (1 + ratePercent / 100));
            amountCents = lineSubtotalCents - baseCents;
          } else {
            amountCents = Math.round(lineSubtotalCents * (ratePercent / 100));
          }

          console.log(`[billing][add-line] single-tax: ratePercent=${ratePercent} baseCents=${baseCents} amountCents=${amountCents} priceIncludesTax=${productInfo?.priceIncludesTax}`);

          const lt = LineTax.create({
            invoiceLineId: line.id,
            taxRateId: productTax.taxRateId,
            kind: productTax.kind as 'vat' | 'withholding_iva' | 'withholding_rent' | 'special',
            rateSnapshot: rateInfo ? rateInfo.percentage : '0',
            baseCents,
            amountCents,
          });
          await repos.business.lineTaxes.save(lt);
          newLineTaxes.push(lt);
        }
      }

      const existingTaxes = await repos.business.lineTaxes.findByInvoice(invoiceId);
      const allLineTaxes = [...existingTaxes.filter(t => t.invoiceLineId !== line.id), ...newLineTaxes];

      const invoiceLines = await repos.business.invoiceLines.findByInvoice(invoiceId);
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
      await repos.business.invoices.save(invoice);

      await recomputeAndSaveTaxTotals(invoiceId, allLineTaxes, repos.business);

      const taxTotals = await repos.business.invoiceTaxTotals.findByInvoice(invoiceId);
      const linesDTO = invoiceLines.map(l => ({
        id: l.id, productId: l.productId, productSnapshot: l.productSnapshot, description: l.description,
        quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents,
        subtotalCents: l.subtotalCents, taxes: [] as any[],
      }));
      const lineTaxDTOs = allLineTaxes.map(t => ({ id: t.id, invoiceLineId: t.invoiceLineId, taxRateId: t.taxRateId, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));
      const taxTotalDTOs = taxTotals.map(t => ({ id: t.id, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));

      return invoiceToDetailDTO(invoice, linesDTO, lineTaxDTOs, taxTotalDTOs);
    });
  }
}
