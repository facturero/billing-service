import { randomUUID } from 'node:crypto';
import { InvoiceNotFoundError, BadRequestError, EstablishmentNotFoundError, EmissionPointNotFoundError, EmissionPointInactiveError, MismatchedTotalsError } from '../../domain/errors.js';
import { Invoice, Sequence } from '../../domain/entities.js';
import type { CustomerSnapshot } from '../../domain/entities.js';
import { UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort } from '../ports.js';
import { IssueInvoiceInput, InvoiceDetailDTO } from '../dts.js';
import { invoiceToDetailDTO } from './create-invoice.js';
import { addCents } from '../../domain/value-objects.js';
import { recomputeAndSaveTaxTotals } from './shared/recompute-tax-totals.js';

export class IssueInvoiceUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly organizationCatalog: OrganizationCatalogPort,
    private readonly customerCatalog: CustomerCatalogPort,
  ) {}

  async execute(
    organizationId: string,
    invoiceId: string,
    input: IssueInvoiceInput,
  ): Promise<InvoiceDetailDTO> {
    // Resolve external data BEFORE the transaction
    const [org, establishment, emissionPoint] = await Promise.all([
      this.organizationCatalog.getOrganization(organizationId),
      this.organizationCatalog.getEstablishment(organizationId, input.establishmentId),
      this.organizationCatalog.getEmissionPoint(organizationId, input.establishmentId, input.emissionPointId),
    ]);

    if (!org) throw new BadRequestError('El perfil fiscal de la organización no está completo');
    if (!establishment) throw new EstablishmentNotFoundError();
    if (!emissionPoint) throw new EmissionPointNotFoundError();
    if (emissionPoint.status !== 'active') throw new EmissionPointInactiveError();

    return this.uow.execute(async (repos) => {
      const invoice = await repos.business.invoices.findByIdAndOrganization(invoiceId, organizationId);
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.status !== 'draft') throw new BadRequestError('La factura ya fue emitida o anulada');

      // Defensive: set customer snapshot if missing (resilient for pre-Phase-2 invoices)
      if (!invoice.customerSnapshot) {
        const customerInfo = await this.customerCatalog.findById(organizationId, invoice.customerId);
        if (customerInfo) {
          const snapshot: CustomerSnapshot = {
            id: customerInfo.id,
            businessName: customerInfo.businessName,
            identification: customerInfo.identification,
            identificationTypeId: customerInfo.identificationTypeId,
            email: customerInfo.email,
            phone: customerInfo.phone,
            type: customerInfo.type,
          };
          invoice.setCustomerSnapshot(snapshot);
        }
      }

      // Set issuer snapshot
      invoice.setIssuerSnapshot({
        legalName: org.legalName,
        tradeName: org.tradeName,
        taxId: org.taxId,
        establishmentCode: establishment.code,
        emissionPointCode: emissionPoint.code,
        address: establishment.address,
      });

      // Auto-provision sequence if it doesn't exist
      let sequence = await repos.business.sequences.findByOrganizationAndPoint(
        organizationId, input.emissionPointId, invoice.documentTypeId,
      );
      if (!sequence) {
        sequence = Sequence.create({
          organizationId,
          countryCode: invoice.countryCode,
          establishmentId: input.establishmentId,
          emissionPointId: input.emissionPointId,
          documentTypeId: invoice.documentTypeId,
        });
      }

      const nextVal = sequence.nextValue();
      const seqFormatted = String(nextVal).padStart(9, '0');
      const number = `${establishment.code}-${emissionPoint.code}-${seqFormatted}`;

      const lines = await repos.business.invoiceLines.findByInvoice(invoiceId);
      const allTaxes: Array<{ id: string; invoiceLineId: string; taxRateId: string; kind: string; rateSnapshot: string; baseCents: number; amountCents: number; }> = [];
      for (const line of lines) {
        const taxes = await repos.business.lineTaxes.findByInvoiceLine(line.id);
        allTaxes.push(...taxes);
      }

      let calculatedSubtotal = 0;
      let calculatedTaxTotal = 0;
      for (const l of lines) {
        calculatedSubtotal = addCents(calculatedSubtotal, l.subtotalCents);
      }
      for (const t of allTaxes) {
        calculatedTaxTotal = addCents(calculatedTaxTotal, t.amountCents);
      }
      const calculatedTotal = addCents(calculatedSubtotal, calculatedTaxTotal);

      if (calculatedSubtotal !== invoice.subtotalCents || calculatedTotal !== invoice.totalCents) {
        throw new MismatchedTotalsError();
      }

      // Ensure tax totals are up-to-date before issuing
      await recomputeAndSaveTaxTotals(invoiceId, allTaxes as any, repos.business);

      invoice.issue(number, input.establishmentId, input.emissionPointId);
      await repos.business.sequences.save(sequence);
      await repos.business.invoices.save(invoice);

      await repos.business.outbox.add({
        eventId: randomUUID(),
        organizationId: invoice.organizationId,
        type: 'billing.invoice.issued',
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        payload: {
          invoiceId: invoice.id,
          number: invoice.number,
          sequentialNumber: seqFormatted,
          organizationId: invoice.organizationId,
          countryCode: invoice.countryCode,
          establishmentId: invoice.establishmentId,
          emissionPointId: invoice.emissionPointId,
          customerSnapshot: invoice.customerSnapshot,
          issuerSnapshot: invoice.issuerSnapshot,
          subtotalCents: invoice.subtotalCents,
          taxTotalCents: invoice.taxTotalCents,
          totalCents: invoice.totalCents,
          currencyCode: invoice.currencyCode,
          lines: lines.map(l => ({
            productId: l.productId,
            description: l.description,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            discountCents: l.discountCents,
            subtotalCents: l.subtotalCents,
            taxes: allTaxes.filter(t => t.invoiceLineId === l.id).map(t => ({
              taxRateId: t.taxRateId,
              kind: t.kind,
              rateSnapshot: t.rateSnapshot,
              baseCents: t.baseCents,
              amountCents: t.amountCents,
            })),
          })),
        },
        occurredAt: new Date(),
      });

      const linesDTO = lines.map(l => ({
        id: l.id, productId: l.productId, productSnapshot: l.productSnapshot, description: l.description,
        quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents,
        subtotalCents: l.subtotalCents, taxes: [] as any[],
      }));
      const lineTaxDTOs = allTaxes.map(t => ({ id: t.id, invoiceLineId: t.invoiceLineId, taxRateId: t.taxRateId, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));
      const taxTotals = await repos.business.invoiceTaxTotals.findByInvoice(invoiceId);
      const taxTotalDTOs = taxTotals.map(t => ({ id: t.id, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));

      return invoiceToDetailDTO(invoice, linesDTO, lineTaxDTOs, taxTotalDTOs);
    });
  }
}
