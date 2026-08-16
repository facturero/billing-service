import { serve } from '@hono/node-server';
import { config } from './infrastructure/config.js';
import { sequelize } from './infrastructure/persistence/sequelize.js';
import './infrastructure/persistence/models.js';
import { SequelizeUnitOfWork, SequelizeInvoiceRepository, SequelizeInvoiceLineRepository, SequelizeLineTaxRepository, SequelizeInvoiceTaxTotalRepository } from './infrastructure/persistence/repositories.js';
import { HttpProductCatalog } from './infrastructure/http/product-catalog.js';
import { HttpTaxRateCatalog } from './infrastructure/http/tax-rate-catalog.js';
import { HttpOrganizationCatalog } from './infrastructure/http/organization-catalog.js';
import { HttpCustomerCatalog } from './infrastructure/http/customer-catalog.js';
import { CreateInvoiceUseCase } from './application/use-cases/create-invoice.js';
import { GetInvoiceUseCase } from './application/use-cases/get-invoice.js';
import { ListInvoicesUseCase } from './application/use-cases/list-invoices.js';
import { UpdateInvoiceUseCase } from './application/use-cases/update-invoice.js';
import { AddLineUseCase } from './application/use-cases/add-line.js';
import { RemoveLineUseCase } from './application/use-cases/remove-line.js';
import { IssueInvoiceUseCase } from './application/use-cases/issue-invoice.js';
import { VoidInvoiceUseCase } from './application/use-cases/void-invoice.js';
import { createApp } from './interface/http/app.js';
import { OutboxRelay } from './infrastructure/messaging/relay.js';
import { startConsumers } from './infrastructure/messaging/consumer.js';

async function main(): Promise<void> {
  console.log('[billing-service] config resuelta:', JSON.stringify({
    PORT: config.PORT,
    DB_HOST: config.DB_HOST,
    DB_NAME: config.DB_NAME,
    PRODUCT_SERVICE_URL: config.PRODUCT_SERVICE_URL,
    TAX_SERVICE_URL: config.TAX_SERVICE_URL,
    ORG_SERVICE_URL: config.ORG_SERVICE_URL,
    CUSTOMER_SERVICE_URL: config.CUSTOMER_SERVICE_URL,
    RABBITMQ_URL: config.RABBITMQ_URL || '(no configurado)',
    DOCUMENT_SERVICE_URL: config.DOCUMENT_SERVICE_URL,
  }));

  await sequelize.authenticate();
  await sequelize.sync();

  const uow = new SequelizeUnitOfWork();
  const invoiceRepo = new SequelizeInvoiceRepository();
  const lineRepo = new SequelizeInvoiceLineRepository();
  const lineTaxRepo = new SequelizeLineTaxRepository();
  const taxTotalRepo = new SequelizeInvoiceTaxTotalRepository();
  const productCatalog = new HttpProductCatalog(config.PRODUCT_SERVICE_URL);
  const taxRateCatalog = new HttpTaxRateCatalog(config.TAX_SERVICE_URL);
  const organizationCatalog = new HttpOrganizationCatalog(config.ORG_SERVICE_URL);
  const customerCatalog = new HttpCustomerCatalog(config.CUSTOMER_SERVICE_URL);

  const app = createApp({
    useCases: {
      createInvoice: new CreateInvoiceUseCase(uow, customerCatalog),
      listInvoices: new ListInvoicesUseCase(invoiceRepo),
      getInvoice: new GetInvoiceUseCase(invoiceRepo, lineRepo, lineTaxRepo, taxTotalRepo),
      updateInvoice: new UpdateInvoiceUseCase(uow, customerCatalog),
      addLine: new AddLineUseCase(uow, productCatalog, taxRateCatalog),
      removeLine: new RemoveLineUseCase(uow),
      issueInvoice: new IssueInvoiceUseCase(uow, organizationCatalog, customerCatalog),
      voidInvoice: new VoidInvoiceUseCase(uow),
    },
    corsOrigin: config.CORS_ORIGIN,
  });

  serve({ fetch: app.fetch, port: config.PORT });
  console.log(`[billing-service] corriendo en puerto ${config.PORT}`);

  // Outbox Relay
  if (config.RABBITMQ_URL) {
    const relay = new OutboxRelay();
    await relay.start(config.RABBITMQ_URL);
    console.log('[billing-service] OutboxRelay iniciado.');
  } else {
    console.log('[billing-service] RABBITMQ_URL no configurado, outbox relay desactivado.');
  }

  // Consumers
  await startConsumers();
}

main().catch((err) => {
  console.error('[billing-service] error al iniciar:', err);
  process.exit(1);
});
