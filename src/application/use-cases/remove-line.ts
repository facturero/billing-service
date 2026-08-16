import { InvoiceNotFoundError, BadRequestError } from '../../domain/errors.js';
import { UnitOfWork } from '../ports.js';
import { InvoiceDetailDTO } from '../dts.js';
import { invoiceToDetailDTO } from './create-invoice.js';
import { addCents } from '../../domain/value-objects.js';
import { recomputeAndSaveTaxTotals } from './shared/recompute-tax-totals.js';

export class RemoveLineUseCase {
  constructor(private readonly uow: UnitOfWork) {}

  async execute(organizationId: string, invoiceId: string, lineId: string): Promise<InvoiceDetailDTO> {
    return this.uow.execute(async (repos) => {
      const invoice = await repos.business.invoices.findByIdAndOrganization(invoiceId, organizationId);
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.status !== 'draft') throw new BadRequestError('Solo se pueden modificar borradores');

      const line = await repos.business.invoiceLines.findById(lineId);
      if (!line || line.invoiceId !== invoiceId) throw new BadRequestError('Línea no encontrada');

      await repos.business.lineTaxes.deleteByInvoiceLine(lineId);
      await repos.business.invoiceLines.delete(lineId);

      const invoiceLines = await repos.business.invoiceLines.findByInvoice(invoiceId);
      const allTaxes = await repos.business.lineTaxes.findByInvoice(invoiceId);

      let newSubtotal = 0;
      let newTaxTotal = 0;
      for (const l of invoiceLines) {
        newSubtotal = addCents(newSubtotal, l.subtotalCents);
      }
      for (const t of allTaxes) {
        newTaxTotal = addCents(newTaxTotal, t.amountCents);
      }
      const newTotal = addCents(newSubtotal, newTaxTotal);

      invoice.updateTotals(newSubtotal, newTaxTotal, newTotal);
      await repos.business.invoices.save(invoice);

      await recomputeAndSaveTaxTotals(invoiceId, allTaxes, repos.business);

      const taxTotals = await repos.business.invoiceTaxTotals.findByInvoice(invoiceId);
      const linesDTO = invoiceLines.map(l => ({
        id: l.id, productId: l.productId, productSnapshot: l.productSnapshot, description: l.description,
        quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents,
        subtotalCents: l.subtotalCents, taxes: [] as any[],
      }));
      const lineTaxDTOs = allTaxes.map(t => ({ id: t.id, invoiceLineId: t.invoiceLineId, taxRateId: t.taxRateId, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));
      const taxTotalDTOs = taxTotals.map(t => ({ id: t.id, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));

      return invoiceToDetailDTO(invoice, linesDTO, lineTaxDTOs, taxTotalDTOs);
    });
  }
}
