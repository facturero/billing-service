import { randomUUID } from 'node:crypto';
import { InvoiceNotFoundError, BadRequestError } from '../../domain/errors.js';
import { UnitOfWork } from '../ports.js';
import { VoidInvoiceInput, InvoiceDetailDTO } from '../dts.js';
import { invoiceToDetailDTO } from './create-invoice.js';

export class VoidInvoiceUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(organizationId: string, invoiceId: string, input: VoidInvoiceInput): Promise<InvoiceDetailDTO> {
    return this.uow.execute(async (repos) => {
      const invoice = await repos.business.invoices.findByIdAndOrganization(invoiceId, organizationId);
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.status !== 'issued') throw new BadRequestError('Solo se pueden anular facturas emitidas');

      invoice.void(input.reason);
      await repos.business.invoices.save(invoice);

      await repos.business.outbox.add({
        eventId: randomUUID(),
        organizationId: invoice.organizationId,
        type: 'billing.invoice.voided',
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        payload: {
          invoiceId: invoice.id,
          number: invoice.number,
          reason: input.reason,
          voidedAt: invoice.voidedAt,
        },
        occurredAt: new Date(),
      });

      const lines = await repos.business.invoiceLines.findByInvoice(invoiceId);
      const lineTaxes = [];
      for (const l of lines) {
        const taxes = await repos.business.lineTaxes.findByInvoiceLine(l.id);
        lineTaxes.push(...taxes);
      }
      const taxTotals = await repos.business.invoiceTaxTotals.findByInvoice(invoiceId);

      const linesDTO = lines.map(l => ({
        id: l.id, productId: l.productId, productSnapshot: l.productSnapshot, description: l.description,
        quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents,
        subtotalCents: l.subtotalCents, taxes: [] as any[],
      }));
      const lineTaxDTOs = lineTaxes.map(t => ({ id: t.id, invoiceLineId: t.invoiceLineId, taxRateId: t.taxRateId, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));
      const taxTotalDTOs = taxTotals.map(t => ({ id: t.id, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));

      return invoiceToDetailDTO(invoice, linesDTO, lineTaxDTOs, taxTotalDTOs);
    });
  }
}
