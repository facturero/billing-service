import { InvoiceNotFoundError, BadRequestError, CustomerNotFoundError, CustomerDisabledError } from '../../domain/errors.js';
import { Invoice } from '../../domain/entities.js';
import type { CustomerSnapshot } from '../../domain/entities.js';
import { UnitOfWork, CustomerCatalogPort } from '../ports.js';
import { UpdateInvoiceInput, InvoiceDetailDTO } from '../dts.js';
import { invoiceToDetailDTO } from './create-invoice.js';

export class UpdateInvoiceUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly customerCatalog: CustomerCatalogPort,
  ) {}

  async execute(organizationId: string, invoiceId: string, input: UpdateInvoiceInput): Promise<InvoiceDetailDTO> {
    return this.uow.execute(async (repos) => {
      const invoice = await repos.business.invoices.findByIdAndOrganization(invoiceId, organizationId);
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.status !== 'draft') throw new BadRequestError('Solo se pueden editar borradores');

      const newCustomerId = input.customerId ?? invoice.customerId;
      let customerSnapshot: CustomerSnapshot | null = invoice.customerSnapshot;

      if (input.customerId && input.customerId !== invoice.customerId) {
        const customerInfo = await this.customerCatalog.findById(organizationId, input.customerId);
        if (!customerInfo) throw new CustomerNotFoundError();
        if (customerInfo.status !== 'active') throw new CustomerDisabledError();

        customerSnapshot = {
          id: customerInfo.id,
          businessName: customerInfo.businessName,
          identification: customerInfo.identification,
          identificationTypeId: customerInfo.identificationTypeId,
          email: customerInfo.email,
          phone: customerInfo.phone,
          type: customerInfo.type,
        };
      }

      const updatedInvoice = Invoice.fromPersistence({
        ...invoice.toPersistence(),
        customerId: newCustomerId,
        customerSnapshot,
        documentTypeId: input.documentTypeId ?? invoice.documentTypeId,
        currencyCode: input.currencyCode ?? invoice.currencyCode,
        updatedAt: new Date(),
      });

      await repos.business.invoices.save(updatedInvoice);

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

      return invoiceToDetailDTO(updatedInvoice, linesDTO, lineTaxDTOs, taxTotalDTOs);
    });
  }
}
