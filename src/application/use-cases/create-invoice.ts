import { randomUUID } from 'node:crypto';
import { Invoice } from '../../domain/entities.js';
import { CustomerNotFoundError, CustomerDisabledError } from '../../domain/errors.js';
import { UnitOfWork, CustomerCatalogPort } from '../ports.js';
import { CreateInvoiceInput, InvoiceDetailDTO, InvoiceLineDTO, InvoiceTaxTotalDTO, LineTaxDTO } from '../dts.js';
import type { CustomerSnapshot } from '../../domain/entities.js';

export class CreateInvoiceUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly customerCatalog: CustomerCatalogPort,
  ) {}

  async execute(input: CreateInvoiceInput & { organizationId: string; countryCode: string }): Promise<InvoiceDetailDTO> {
    return this.uow.execute(async (repos) => {
      const customerInfo = await this.customerCatalog.findById(input.organizationId, input.customerId);
      if (!customerInfo) throw new CustomerNotFoundError();
      if (customerInfo.status !== 'active') throw new CustomerDisabledError();

      const snapshot: CustomerSnapshot = {
        id: customerInfo.id,
        businessName: customerInfo.businessName,
        identification: customerInfo.identification,
        identificationTypeId: customerInfo.identificationTypeId,
        email: customerInfo.email,
        phone: customerInfo.phone,
        type: customerInfo.type,
      };

      const invoice = Invoice.create({
        organizationId: input.organizationId,
        countryCode: input.countryCode,
        documentTypeId: input.documentTypeId,
        customerId: input.customerId,
        currencyCode: input.currencyCode,
      });
      invoice.setCustomerSnapshot(snapshot);

      await repos.business.invoices.save(invoice);

      await repos.business.outbox.add({
        eventId: randomUUID(),
        organizationId: invoice.organizationId,
        type: 'billing.invoice.created',
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        payload: {
          invoiceId: invoice.id,
          organizationId: invoice.organizationId,
          status: invoice.status,
          totalCents: invoice.totalCents,
        },
        occurredAt: new Date(),
      });

      return invoiceToDetailDTO(invoice, [], [], []);
    });
  }
}

export function invoiceToDetailDTO(
  invoice: Invoice,
  lines: InvoiceLineDTO[],
  lineTaxes: LineTaxDTO[],
  taxTotals: InvoiceTaxTotalDTO[]
): InvoiceDetailDTO {
  const linesWithTaxes = lines.map((line) => ({
    ...line,
    taxes: lineTaxes.filter((lt) => lt.invoiceLineId === line.id),
  }));

  return {
    id: invoice.id,
    organizationId: invoice.organizationId,
    countryCode: invoice.countryCode,
    documentTypeId: invoice.documentTypeId,
    number: invoice.number,
    establishmentId: invoice.establishmentId,
    emissionPointId: invoice.emissionPointId,
    customerId: invoice.customerId,
    customerSnapshot: invoice.customerSnapshot,
    issuerSnapshot: invoice.issuerSnapshot,
    issueDate: invoice.issueDate ? invoice.issueDate.toISOString() : null,
    currencyCode: invoice.currencyCode,
    subtotalCents: invoice.subtotalCents,
    taxTotalCents: invoice.taxTotalCents,
    totalCents: invoice.totalCents,
    subtotal: (invoice.subtotalCents / 100).toFixed(2),
    taxTotal: (invoice.taxTotalCents / 100).toFixed(2),
    total: (invoice.totalCents / 100).toFixed(2),
    status: invoice.status,
    voidedAt: invoice.voidedAt ? invoice.voidedAt.toISOString() : null,
    voidedReason: invoice.voidedReason,
    lines: linesWithTaxes,
    taxTotals: taxTotals,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}
