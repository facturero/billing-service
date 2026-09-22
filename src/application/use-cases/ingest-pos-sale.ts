import { Invoice } from '../../domain/entities.js';
import {
  BadRequestError,
  CustomerDisabledError,
  CustomerNotFoundError,
  EmissionPointInactiveError,
  EmissionPointNotFoundError,
  EstablishmentNotFoundError,
} from '../../domain/errors.js';
import {
  UnitOfWork,
  CustomerCatalogPort,
  DocumentTypeCatalogPort,
  OrganizationCatalogPort,
  ProductCatalogPort,
  TaxRatePort,
} from '../ports.js';
import { IngestPosSaleInput, InvoiceDetailDTO } from '../dts.js';
import type { CustomerSnapshot } from '../../domain/entities.js';
import { addLineInTransaction } from './shared/add-line-in-transaction.js';
import { invoiceToDetailDTO } from './create-invoice.js';
import { issueInvoiceInTransaction } from './issue-invoice.js';

/** Código SRI de la factura. Una venta de caja siempre es una factura, nunca otro comprobante. */
const INVOICE_DOCUMENT_TYPE_CODE = '01';

export interface IngestPosSaleResult {
  invoice: InvoiceDetailDTO;
  /** true si esta venta ya estaba ingresada: el POS reintentó y se le devuelve la misma factura. */
  alreadyIngested: boolean;
}

/**
 * Convierte una venta del POS en una factura EMITIDA, en una sola transacción:
 * crea la factura, le pone sus líneas con los impuestos del catálogo y la emite
 * (número desde la secuencia del punto de emisión del terminal). Emitir es lo
 * que dispara el descuento de stock en inventory-service y el envío al SRI en
 * fiscal-ecuador; en caja la venta ya ocurrió y ya se cobró, así que no tiene
 * sentido dejarla en borrador esperando a que alguien la confirme.
 *
 * **Idempotencia.** El POS reintenta una venta hasta que la da por subida, y
 * puede perder la respuesta después de que billing la haya guardado. Por eso lo
 * primero es buscar (terminal, venta local): si ya existe, se devuelve aquella
 * factura sin crear nada. El índice único de `invoices` lo respalda a nivel de
 * base, para que dos reintentos simultáneos tampoco produzcan dos facturas.
 *
 * **Totales.** Los del terminal no mandan: se recalculan desde el catálogo, que
 * es la única fuente de verdad del IVA. Si no coinciden (un precio cambió en el
 * CRM después de que el terminal se llevara su copia), la factura vale por lo
 * recalculado y la diferencia queda anotada en `posTotalsDiffCents` para poder
 * auditarla. Rechazar la venta dejaría al terminal reintentando para siempre
 * una venta que en la vida real ya se cobró.
 */
export class IngestPosSaleUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly organizationCatalog: OrganizationCatalogPort,
    private readonly customerCatalog: CustomerCatalogPort,
    private readonly documentTypeCatalog: DocumentTypeCatalogPort,
    private readonly productCatalog: ProductCatalogPort,
    private readonly taxRateCatalog: TaxRatePort,
  ) {}

  async execute(
    organizationId: string,
    countryCode: string,
    input: IngestPosSaleInput,
  ): Promise<IngestPosSaleResult> {
    if (input.lines.length === 0) throw new BadRequestError('La venta no tiene líneas');

    // Todo lo externo se resuelve ANTES de abrir la transacción, igual que en
    // la emisión desde el CRM: una llamada HTTP lenta no debe tener abierta la
    // fila de la secuencia, que es el cuello de botella de la numeración.
    const [org, establishment, emissionPoint, documentTypes] = await Promise.all([
      this.organizationCatalog.getOrganization(organizationId),
      this.organizationCatalog.getEstablishment(organizationId, input.establishmentId),
      this.organizationCatalog.getEmissionPoint(organizationId, input.establishmentId, input.emissionPointId),
      this.documentTypeCatalog.listByCountry(countryCode),
    ]);

    if (!org) throw new BadRequestError('El perfil fiscal de la organización no está completo');
    if (!establishment || establishment.status !== 'active') throw new EstablishmentNotFoundError();
    if (!emissionPoint) throw new EmissionPointNotFoundError();
    if (emissionPoint.status !== 'active') throw new EmissionPointInactiveError();

    const documentType = documentTypes.find((dt) => dt.code === INVOICE_DOCUMENT_TYPE_CODE);
    if (!documentType) throw new BadRequestError(`No hay tipo de comprobante ${INVOICE_DOCUMENT_TYPE_CODE} para ${countryCode}`);

    const customer = input.customerId
      ? await this.customerCatalog.findById(organizationId, input.customerId)
      : await this.customerCatalog.findFinalConsumer(organizationId);

    if (!customer) throw new CustomerNotFoundError();
    if (customer.status !== 'active') throw new CustomerDisabledError();

    return this.uow.execute(async (repos) => {
      const existing = await repos.business.invoices.findByPosSale(organizationId, input.terminalId, input.posSaleId);
      if (existing) {
        const lines = await repos.business.invoiceLines.findByInvoice(existing.id);
        const lineTaxes = await repos.business.lineTaxes.findByInvoice(existing.id);
        const taxTotals = await repos.business.invoiceTaxTotals.findByInvoice(existing.id);
        return {
          alreadyIngested: true,
          invoice: invoiceToDetailDTO(
            existing,
            lines.map((l) => ({
              id: l.id, productId: l.productId, productSnapshot: l.productSnapshot, description: l.description,
              quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents,
              subtotalCents: l.subtotalCents, taxes: [],
            })),
            lineTaxes.map((t) => ({ id: t.id, invoiceLineId: t.invoiceLineId, taxRateId: t.taxRateId, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents })),
            taxTotals.map((t) => ({ id: t.id, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents })),
          ),
        };
      }

      const invoice = Invoice.create({
        organizationId,
        countryCode,
        documentTypeId: documentType.id,
        customerId: customer.id,
        currencyCode: input.currencyCode ?? 'USD',
        posTerminalId: input.terminalId,
        posSaleId: input.posSaleId,
      });

      const snapshot: CustomerSnapshot = {
        id: customer.id,
        businessName: customer.businessName,
        identification: customer.identification,
        identificationTypeId: customer.identificationTypeId,
        identificationTypeCode: customer.identificationTypeCode,
        email: customer.email,
        phone: customer.phone,
        type: customer.type,
      };
      invoice.setCustomerSnapshot(snapshot);
      await repos.business.invoices.save(invoice);

      for (const line of input.lines) {
        await addLineInTransaction(repos.business, invoice, {
          productId: line.productId,
          description: line.description ?? '',
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountCents: line.discountCents,
        }, {
          productCatalog: this.productCatalog,
          taxRateCatalog: this.taxRateCatalog,
        });
      }

      if (input.posTotalCents !== undefined && input.posTotalCents !== invoice.totalCents) {
        invoice.setPosTotalsDiff(input.posTotalCents - invoice.totalCents);
        await repos.business.invoices.save(invoice);
      }

      const detail = await issueInvoiceInTransaction(repos.business, invoice, {
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

      return { invoice: detail, alreadyIngested: false };
    });
  }
}
