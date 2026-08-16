import { InvoiceNotFoundError } from '../../domain/errors.js';
import { InvoiceLineRepository, InvoiceRepository, InvoiceTaxTotalRepository, LineTaxRepository } from '../../domain/repositories.js';
import { InvoiceLineDTO } from '../dts.js';
import { invoiceToDetailDTO } from './create-invoice.js';

export class GetInvoiceUseCase {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly lineRepo: InvoiceLineRepository,
    private readonly lineTaxRepo: LineTaxRepository,
    private readonly taxTotalRepo: InvoiceTaxTotalRepository,
  ) {}

  async execute(organizationId: string, invoiceId: string) {
    const invoice = await this.invoiceRepo.findByIdAndOrganization(invoiceId, organizationId);
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);

    const lines = await this.lineRepo.findByInvoice(invoiceId);
    const lineTaxes = [];
    for (const line of lines) {
      const taxes = await this.lineTaxRepo.findByInvoiceLine(line.id);
      for (const t of taxes) {
        lineTaxes.push({
          id: t.id,
          invoiceLineId: t.invoiceLineId,
          taxRateId: t.taxRateId,
          kind: t.kind,
          rateSnapshot: t.rateSnapshot,
          baseCents: t.baseCents,
          amountCents: t.amountCents,
        });
      }
    }

    const taxTotals = (await this.taxTotalRepo.findByInvoice(invoiceId)).map((t) => ({
      id: t.id,
      kind: t.kind,
      rateSnapshot: t.rateSnapshot,
      baseCents: t.baseCents,
      amountCents: t.amountCents,
    }));

    const linesDTO: InvoiceLineDTO[] = lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productSnapshot: l.productSnapshot ? { id: l.productSnapshot.id, name: l.productSnapshot.name, sku: l.productSnapshot.sku, unit: l.productSnapshot.unit } : null,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      subtotalCents: l.subtotalCents,
      taxes: [],
    }));

    return invoiceToDetailDTO(invoice, linesDTO, lineTaxes, taxTotals);
  }
}
