import { Hono } from 'hono';
import { CreateInvoiceUseCase } from '../../application/use-cases/create-invoice.js';
import { GetInvoiceUseCase } from '../../application/use-cases/get-invoice.js';
import { ListInvoicesUseCase } from '../../application/use-cases/list-invoices.js';
import { UpdateInvoiceUseCase } from '../../application/use-cases/update-invoice.js';
import { AddLineUseCase } from '../../application/use-cases/add-line.js';
import { RemoveLineUseCase } from '../../application/use-cases/remove-line.js';
import { IssueInvoiceUseCase } from '../../application/use-cases/issue-invoice.js';
import { IngestPosSaleUseCase } from '../../application/use-cases/ingest-pos-sale.js';
import { IssueCreditNoteUseCase } from '../../application/use-cases/issue-credit-note.js';
import { VoidInvoiceUseCase } from '../../application/use-cases/void-invoice.js';
import {
  createInvoiceController,
  listInvoicesController,
  getInvoiceController,
  updateInvoiceController,
  addLineController,
  removeLineController,
  issueInvoiceController,
  ingestPosSaleController,
  issueCreditNoteController,
  voidInvoiceController,
} from './controllers.js';
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  addLineSchema,
  issueInvoiceSchema,
  ingestPosSaleSchema,
  creditNoteSchema,
  voidInvoiceSchema,
  validateJson,
} from './validators.js';
import { ContextVariables, requireOrganization, requirePermission } from './middlewares.js';

type Vars = { Variables: ContextVariables };

export interface AppDependencies {
  useCases: {
    createInvoice: CreateInvoiceUseCase;
    listInvoices: ListInvoicesUseCase;
    getInvoice: GetInvoiceUseCase;
    updateInvoice: UpdateInvoiceUseCase;
    addLine: AddLineUseCase;
    removeLine: RemoveLineUseCase;
    issueInvoice: IssueInvoiceUseCase;
    ingestPosSale: IngestPosSaleUseCase;
    issueCreditNote: IssueCreditNoteUseCase;
    voidInvoice: VoidInvoiceUseCase;
  };
  corsOrigin: string;
}

export function healthRoutes(): Hono {
  const r = new Hono();
  r.get('/health', (c) => c.json({ status: 'ok' }));
  return r;
}

export function invoiceRoutes(deps: AppDependencies): Hono<Vars> {
  const r = new Hono<Vars>();
  const { useCases } = deps;

  r.get('/invoices',
    requireOrganization(),
    requirePermission('invoice:read'),
    listInvoicesController(useCases.listInvoices));

  r.post('/invoices',
    requireOrganization(),
    requirePermission('invoice:create'),
    validateJson(createInvoiceSchema),
    createInvoiceController(useCases.createInvoice));

  r.get('/invoices/:id',
    requireOrganization(),
    requirePermission('invoice:read'),
    getInvoiceController(useCases.getInvoice));

  r.patch('/invoices/:id',
    requireOrganization(),
    requirePermission('invoice:update'),
    validateJson(updateInvoiceSchema),
    updateInvoiceController(useCases.updateInvoice));

  r.post('/invoices/:id/lines',
    requireOrganization(),
    requirePermission('invoice:update'),
    validateJson(addLineSchema),
    addLineController(useCases.addLine));

  r.delete('/invoices/:id/lines/:lineId',
    requireOrganization(),
    requirePermission('invoice:update'),
    removeLineController(useCases.removeLine));

  // El POS sube una venta ya cobrada y billing la convierte en factura emitida:
  // por eso pide los dos permisos, crear y emitir.
  r.post('/invoices/from-pos',
    requireOrganization(),
    requirePermission('invoice:create'),
    requirePermission('invoice:issue'),
    validateJson(ingestPosSaleSchema),
    ingestPosSaleController(useCases.ingestPosSale));

  r.post('/invoices/:id/issue',
    requireOrganization(),
    requirePermission('invoice:issue'),
    validateJson(issueInvoiceSchema),
    issueInvoiceController(useCases.issueInvoice));

  r.post('/invoices/:id/void',
    requireOrganization(),
    requirePermission('invoice:void'),
    validateJson(voidInvoiceSchema),
    voidInvoiceController(useCases.voidInvoice));

  r.post('/invoices/:id/credit-note',
    requireOrganization(),
    requirePermission('invoice:issue'),
    validateJson(creditNoteSchema),
    issueCreditNoteController(useCases.issueCreditNote));

  return r;
}
