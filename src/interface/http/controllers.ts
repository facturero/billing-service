import { Context } from 'hono';
import { CreateInvoiceUseCase } from '../../application/use-cases/create-invoice.js';
import { GetInvoiceUseCase } from '../../application/use-cases/get-invoice.js';
import { ListInvoicesUseCase } from '../../application/use-cases/list-invoices.js';
import { UpdateInvoiceUseCase } from '../../application/use-cases/update-invoice.js';
import { AddLineUseCase } from '../../application/use-cases/add-line.js';
import { RemoveLineUseCase } from '../../application/use-cases/remove-line.js';
import { IssueInvoiceUseCase } from '../../application/use-cases/issue-invoice.js';
import { VoidInvoiceUseCase } from '../../application/use-cases/void-invoice.js';
import { ContextVariables } from './middlewares.js';

// ── Invoices ───────────────────────────────────────────────────────────────

export function createInvoiceController(useCase: CreateInvoiceUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const countryCode = c.get('countryCode') || 'EC';
    const body = c.req.valid('json' as never) as {
      customerId: string;
      documentTypeId: string;
      currencyCode: string;
    };
    const result = await useCase.execute({
      organizationId,
      countryCode,
      customerId: body.customerId,
      documentTypeId: body.documentTypeId,
      currencyCode: body.currencyCode || 'USD',
    });
    return c.json(result, 201);
  };
}

export function listInvoicesController(useCase: ListInvoicesUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const status = c.req.query('status');
    const customerId = c.req.query('customerId');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const result = await useCase.execute(organizationId, { status, customerId, from, to });
    return c.json(result, 200);
  };
}

export function getInvoiceController(useCase: GetInvoiceUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const id = c.req.param('id') ?? '';
    const result = await useCase.execute(organizationId, id);
    return c.json(result, 200);
  };
}

export function updateInvoiceController(useCase: UpdateInvoiceUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const id = c.req.param('id') ?? '';
    const body = c.req.valid('json' as never) as {
      customerId?: string;
      documentTypeId?: string;
      currencyCode?: string;
    };
    const result = await useCase.execute(organizationId, id, body);
    return c.json(result, 200);
  };
}

export function addLineController(useCase: AddLineUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const invoiceId = c.req.param('id') ?? '';
    const body = c.req.valid('json' as never) as {
      productId: string;
      description: string;
      quantity: number;
      unitPrice: string;
      discountCents?: number;
    };
    const result = await useCase.execute(organizationId, invoiceId, {
      productId: body.productId,
      description: body.description,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      discountCents: body.discountCents,
    });
    return c.json(result, 201);
  };
}

export function removeLineController(useCase: RemoveLineUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const invoiceId = c.req.param('id') ?? '';
    const lineId = c.req.param('lineId') ?? '';
    const result = await useCase.execute(organizationId, invoiceId, lineId);
    return c.json(result, 200);
  };
}

export function issueInvoiceController(useCase: IssueInvoiceUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const invoiceId = c.req.param('id') ?? '';
    const body = c.req.valid('json' as never) as {
      establishmentId: string;
      emissionPointId: string;
    };
    const result = await useCase.execute(organizationId, invoiceId, {
      establishmentId: body.establishmentId,
      emissionPointId: body.emissionPointId,
    });
    return c.json(result, 200);
  };
}

export function voidInvoiceController(useCase: VoidInvoiceUseCase) {
  return async (c: Context<{ Variables: ContextVariables }>) => {
    const organizationId = c.get('organizationId');
    const invoiceId = c.req.param('id') ?? '';
    const body = c.req.valid('json' as never) as { reason: string };
    const result = await useCase.execute(organizationId, invoiceId, {
      reason: body.reason,
    });
    return c.json(result, 200);
  };
}
