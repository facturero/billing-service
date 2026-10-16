import { InvoiceNotFoundError, BadRequestError, EstablishmentNotFoundError, EmissionPointNotFoundError, EmissionPointInactiveError } from '../../domain/errors.js';
import { Invoice, InvoiceLine, LineTax } from '../../domain/entities.js';
import { moneyToCents, moneyFromDecimalString, addCents } from '../../domain/value-objects.js';
import { UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, DocumentTypeCatalogPort, TaxRatePort } from '../ports.js';
import { InvoiceDetailDTO } from '../dts.js';
import { issueInvoiceInTransaction } from './issue-invoice.js';
import { recomputeAndSaveTaxTotals } from './shared/recompute-tax-totals.js';

/**
 * Un motivo de la nota de débito: una razón y cuánto se cobra de más (SIN impuestos), con el IVA que le corresponde.
 */
export interface DebitNoteMotive {
  /** Razón tal como la ve el SRI y el cliente (p. ej. «Intereses por mora»). */
  reason: string;
  /** Importe sin impuestos, decimal con punto (`"10.00"`). */
  amount: string;
  /** Tarifa de IVA de tax-service que lo grava (IVA 0 %, 15 %…). */
  taxRateId: string;
}

export interface IssueDebitNoteInput {
  establishmentId: string;
  emissionPointId: string;
  motives: DebitNoteMotive[];
  /** Forma de pago de la Tabla 24 del SRI, si se conoce. */
  paymentMethodCode?: string | null;
  userId?: string;
}

/** Máximo de motivos: el esquema del SRI los admite sin tope, pero más de unos pocos es un error de captura. */
export const MAX_DEBIT_NOTE_MOTIVES = 20;

/**
 * Las líneas de una nota de débito no son productos: son motivos. `invoice_lines.product_id` es obligatorio, así que llevan el id
 * «vacío» (todo ceros). Ningún consumidor lo confunde con un producto real: inventory ignora los comprobantes que no son facturas y
 * cualquier consulta por producto simplemente no lo encuentra.
 */
export const NO_PRODUCT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Nota de débito: AÑADE valores a una factura ya emitida (intereses de mora, gastos de cobranza, un cargo olvidado). Se emite por el
 * mismo flujo que una factura, con documento tipo 05 y su propia serie, referenciando la factura original. No toca el original ni
 * mueve inventario.
 */
export class IssueDebitNoteUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly organizationCatalog: OrganizationCatalogPort,
    private readonly customerCatalog: CustomerCatalogPort,
    private readonly documentTypeCatalog: DocumentTypeCatalogPort,
    private readonly taxRateCatalog: TaxRatePort,
  ) {}

  async execute(organizationId: string, originalInvoiceId: string, input: IssueDebitNoteInput): Promise<InvoiceDetailDTO> {
    if (!input.motives?.length) throw new BadRequestError('La nota de débito necesita al menos un motivo');
    if (input.motives.length > MAX_DEBIT_NOTE_MOTIVES) {
      throw new BadRequestError(`Una nota de débito admite hasta ${MAX_DEBIT_NOTE_MOTIVES} motivos`);
    }
    for (const [i, m] of input.motives.entries()) {
      if (!m.reason?.trim()) throw new BadRequestError(`El motivo ${i + 1} necesita su razón`);
      if (m.reason.trim().length > 300) throw new BadRequestError(`La razón del motivo ${i + 1} pasa de 300 caracteres`);
    }

    // Se resuelve lo externo ANTES de la transacción.
    const [org, establishment, emissionPoint] = await Promise.all([
      this.organizationCatalog.getOrganization(organizationId),
      this.organizationCatalog.getEstablishment(organizationId, input.establishmentId),
      this.organizationCatalog.getEmissionPoint(organizationId, input.establishmentId, input.emissionPointId),
    ]);
    if (!org) throw new BadRequestError('El perfil fiscal de la organización no está completo');
    if (!establishment) throw new EstablishmentNotFoundError();
    if (establishment.status !== 'active') throw new EstablishmentNotFoundError();
    if (!emissionPoint) throw new EmissionPointNotFoundError();
    if (emissionPoint.status !== 'active') throw new EmissionPointInactiveError();

    return this.uow.execute(async (repos) => {
      const original = await repos.business.invoices.findByIdAndOrganization(originalInvoiceId, organizationId);
      if (!original) throw new InvoiceNotFoundError(originalInvoiceId);
      if (original.status !== 'issued') {
        throw new BadRequestError('Solo una factura emitida (no anulada ni en borrador) se puede ampliar con una nota de débito');
      }
      // El SRI exige que la nota salga del MISMO establecimiento del comprobante que modifica.
      if (original.establishmentId && original.establishmentId !== input.establishmentId) {
        throw new BadRequestError('La nota de débito debe emitirse en el mismo establecimiento del comprobante original');
      }
      if (!original.customerSnapshot) throw new BadRequestError('El comprobante original no tiene datos del cliente');

      const documentTypes = await this.documentTypeCatalog.listByCountry(original.countryCode);
      const originalType = documentTypes.find((t) => t.id === original.documentTypeId);
      if (originalType && originalType.code !== '01') {
        throw new BadRequestError('Una nota de débito solo modifica una factura');
      }
      const ndType = documentTypes.find((t) => t.code === '05');
      if (!ndType) {
        throw new BadRequestError('El catálogo fiscal no tiene configurado un tipo de documento de nota de débito (05)');
      }

      const nd = Invoice.create({
        organizationId,
        countryCode: original.countryCode,
        documentTypeId: ndType.id,
        customerId: original.customerId,
        currencyCode: original.currencyCode,
        relatedInvoiceId: original.id,
        paymentMethodCode: input.paymentMethodCode ?? null,
      });
      nd.setCustomerSnapshot(original.customerSnapshot);

      const lineTaxes: LineTax[] = [];
      let subtotal = 0;
      let taxTotal = 0;
      for (const [i, motive] of input.motives.entries()) {
        const amountCents = moneyToCents(moneyFromDecimalString(motive.amount, original.currencyCode));
        if (!(amountCents > 0)) throw new BadRequestError(`El valor del motivo ${i + 1} debe ser mayor que cero`);

        const rate = await this.taxRateCatalog.findRate(original.countryCode, motive.taxRateId);
        if (!rate) throw new BadRequestError(`El impuesto del motivo ${i + 1} no existe`);
        if (rate.kind !== 'vat') throw new BadRequestError(`El motivo ${i + 1} solo admite IVA`);
        const taxCents = Math.round(amountCents * (parseFloat(rate.percentage) / 100));

        const line = InvoiceLine.create({
          invoiceId: nd.id,
          productId: NO_PRODUCT_ID,
          description: motive.reason.trim(),
          quantity: 1,
          unitPriceCents: amountCents,
          discountCents: 0,
          subtotalCents: amountCents,
        });
        await repos.business.invoiceLines.save(line);
        const tax = LineTax.create({
          invoiceLineId: line.id,
          taxRateId: motive.taxRateId,
          kind: 'vat',
          rateSnapshot: rate.percentage,
          baseCents: amountCents,
          amountCents: taxCents,
        });
        await repos.business.lineTaxes.save(tax);
        lineTaxes.push(tax);
        subtotal = addCents(subtotal, amountCents);
        taxTotal = addCents(taxTotal, taxCents);
      }

      nd.updateTotals(subtotal, taxTotal, addCents(subtotal, taxTotal));
      await repos.business.invoices.save(nd);
      await recomputeAndSaveTaxTotals(nd.id, lineTaxes, repos.business);

      // El borrador ya tiene líneas, impuestos y snapshots: la emisión (folio 05, evento con referencias) corre por el flujo estándar.
      return issueInvoiceInTransaction(repos.business, nd, {
        org,
        establishment,
        emissionPoint,
        establishmentId: input.establishmentId,
        emissionPointId: input.emissionPointId,
        userId: input.userId,
      }, {
        customerCatalog: this.customerCatalog,
        documentTypeCatalog: this.documentTypeCatalog,
      });
    });
  }
}
