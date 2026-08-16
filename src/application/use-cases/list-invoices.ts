import { InvoiceRepository } from '../../domain/repositories.js';
import { ListInvoicesParams, InvoiceSummaryDTO } from '../dts.js';

export class ListInvoicesUseCase {
  constructor(private readonly invoiceRepo: InvoiceRepository) {}

  async execute(organizationId: string, params: ListInvoicesParams): Promise<InvoiceSummaryDTO[]> {
    const invoices = await this.invoiceRepo.findByOrganization(organizationId, params);
    const summaries: InvoiceSummaryDTO[] = [];
    for (const inv of invoices) {
      summaries.push({
        id: inv.id,
        number: inv.number,
        customerName: inv.customerSnapshot ? inv.customerSnapshot.businessName : 'Cliente eliminado',
        customerIdentification: inv.customerSnapshot ? inv.customerSnapshot.identification : '-',
        subtotal: (inv.subtotalCents / 100).toFixed(2),
        taxTotal: (inv.taxTotalCents / 100).toFixed(2),
        total: (inv.totalCents / 100).toFixed(2),
        currencyCode: inv.currencyCode,
        status: inv.status,
        issueDate: inv.issueDate ? inv.issueDate.toISOString() : null,
        createdAt: inv.createdAt.toISOString(),
      });
    }
    return summaries;
  }
}
