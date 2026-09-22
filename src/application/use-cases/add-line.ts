import { randomUUID } from 'node:crypto';
import { InvoiceNotFoundError, BadRequestError } from '../../domain/errors.js';
import { UnitOfWork, ProductCatalogPort, TaxRatePort } from '../ports.js';
import { AddLineInput, InvoiceDetailDTO } from '../dts.js';
import { addLineInTransaction } from './shared/add-line-in-transaction.js';

export class AddLineUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly productCatalog: ProductCatalogPort,
    private readonly taxRateCatalog: TaxRatePort,
  ) {}

  async execute(
    organizationId: string,
    invoiceId: string,
    input: AddLineInput,
  ): Promise<InvoiceDetailDTO> {
    return this.uow.execute(async (repos) => {
      const invoice = await repos.business.invoices.findByIdAndOrganization(invoiceId, organizationId);
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.status !== 'draft') throw new BadRequestError('Solo se pueden modificar borradores');

      const detail = await addLineInTransaction(repos.business, invoice, input, {
        productCatalog: this.productCatalog,
        taxRateCatalog: this.taxRateCatalog,
      });

      // Modificar el contenido de una factura (aunque sea borrador) cambia sus
      // importes: tiene que quedar en la bitácora, no solo el alta y la emisión.
      await repos.business.outbox.add({
        eventId: randomUUID(),
        organizationId: invoice.organizationId,
        type: 'billing.invoice.line_added',
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

      return detail;
    });
  }
}
