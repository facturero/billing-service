import { InvoiceNotFoundError, BadRequestError, EstablishmentNotFoundError, EmissionPointNotFoundError, EmissionPointInactiveError } from '../../domain/errors.js';
import { Invoice, InvoiceLine, LineTax } from '../../domain/entities.js';
import { UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, DocumentTypeCatalogPort } from '../ports.js';
import { InvoiceDetailDTO } from '../dts.js';
import { issueInvoiceInTransaction } from './issue-invoice.js';

export interface IssueCreditNoteInput {
  establishmentId: string;
  emissionPointId: string;
  /** Motivo de la nota de crédito (campo `motivo` del SRI, obligatorio). */
  reason: string;
  userId?: string;
}

/**
 * Nota de crédito (#20): clona la factura original (líneas e impuestos, misma
 * cuantía = reversión total) en un borrador con document_type_id del tipo 04,
 * y lo emite por el mismo flujo que una factura. El original puede estar
 * emitido O anulado: fiscal-ecuador responde "emita una nota de crédito" cuando
 * la factura ya fue enviada al SRI y no se puede anular.
 */
export class IssueCreditNoteUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly organizationCatalog: OrganizationCatalogPort,
    private readonly customerCatalog: CustomerCatalogPort,
    private readonly documentTypeCatalog: DocumentTypeCatalogPort,
  ) {}

  async execute(
    organizationId: string,
    originalInvoiceId: string,
    input: IssueCreditNoteInput,
  ): Promise<InvoiceDetailDTO> {
    if (!input.reason?.trim()) {
      throw new BadRequestError('El motivo de la nota de crédito es obligatorio');
    }

    // Resolve external data BEFORE the transaction
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
      if (original.status === 'draft') {
        throw new BadRequestError('Un comprobante sin emitir no se puede corregir con una nota de crédito');
      }
      // El SRI exige que la nota de crédito salga del MISMO establecimiento del
      // comprobante que modifica (no así del mismo punto de emisión).
      if (original.establishmentId && original.establishmentId !== input.establishmentId) {
        throw new BadRequestError('La nota de crédito debe emitirse en el mismo establecimiento del comprobante original');
      }
      if (!original.customerSnapshot) {
        throw new BadRequestError('El comprobante original no tiene datos del cliente');
      }

      // El catálogo documental debe tener un tipo 04; sin él no sabemos qué id
      // usar para la secuencia/evento. Se exige aquí para no emitir una NC que
      // luego fiscal interpretaría como factura (documentTypeCode '01').
      const documentTypes = await this.documentTypeCatalog.listByCountry(original.countryCode);
      const ncType = documentTypes.find((t) => t.code === '04');
      if (!ncType) {
        throw new BadRequestError('El catálogo fiscal no tiene configurado un tipo de documento de nota de crédito (04)');
      }

      // Clona el original: misma cuantía y mismos impuestos (reversión total).
      const nc = Invoice.create({
        organizationId,
        countryCode: original.countryCode,
        documentTypeId: ncType.id,
        customerId: original.customerId,
        currencyCode: original.currencyCode,
        relatedInvoiceId: original.id,
        creditNoteReason: input.reason,
      });
      nc.setCustomerSnapshot(original.customerSnapshot);

      const originalLines = await repos.business.invoiceLines.findByInvoice(original.id);
      for (const line of originalLines) {
        const newLine = InvoiceLine.create({
          invoiceId: nc.id,
          productId: line.productId,
          productSnapshot: line.productSnapshot ?? undefined,
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          discountCents: line.discountCents,
          subtotalCents: line.subtotalCents,
        });
        await repos.business.invoiceLines.save(newLine);

        const taxes = await repos.business.lineTaxes.findByInvoiceLine(line.id);
        for (const tax of taxes) {
          await repos.business.lineTaxes.save(LineTax.create({
            invoiceLineId: newLine.id,
            taxRateId: tax.taxRateId,
            kind: tax.kind,
            rateSnapshot: tax.rateSnapshot,
            baseCents: tax.baseCents,
            amountCents: tax.amountCents,
          }));
        }
      }

      nc.updateTotals(original.subtotalCents, original.taxTotalCents, original.totalCents);
      await repos.business.invoices.save(nc);

      // El borrador de NC ya tiene líneas/impuestos/snapshots; la emisión
      // (folio 04, evento con refs) corre por el flujo estándar.
      return issueInvoiceInTransaction(repos.business, nc, {
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