import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

export const createInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  documentTypeId: z.string().uuid(),
  currencyCode: z.string().length(3).default('USD'),
});

export const updateInvoiceSchema = z.object({
  customerId: z.string().uuid().optional(),
  documentTypeId: z.string().uuid().optional(),
  currencyCode: z.string().length(3).optional(),
}).optional();

export const addLineSchema = z.object({
  productId: z.string().uuid(),
  description: z.string().min(1).max(255),
  quantity: z.number().positive(),
  unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Precio inválido'),
  discountCents: z.number().int().min(0).optional(),
});

export const issueInvoiceSchema = z.object({
  establishmentId: z.string().uuid(),
  emissionPointId: z.string().uuid(),
});

export const creditNoteSchema = z.object({
  establishmentId: z.string().uuid(),
  emissionPointId: z.string().uuid(),
  reason: z.string().min(1).max(300),
});

// Ingesta de una venta del POS. `posSaleId` es el id de la venta en la base
// local del terminal (Prisma lo genera como entero autoincremental), por eso
// es texto libre y no un uuid.
export const ingestPosSaleSchema = z.object({
  terminalId: z.string().min(1).max(64),
  posSaleId: z.string().min(1).max(64),
  establishmentId: z.string().uuid(),
  emissionPointId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  currencyCode: z.string().length(3).optional(),
  posTotalCents: z.number().int().optional(),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    description: z.string().max(255).optional(),
    quantity: z.number().positive(),
    unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Precio inválido'),
    discountCents: z.number().int().min(0).optional(),
  })).min(1),
});

export const voidInvoiceSchema = z.object({
  reason: z.string().min(1).max(255),
});

export const listInvoicesQuerySchema = z.object({
  status: z.enum(['draft', 'issued', 'voided']).optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const validateJson = (schema: z.ZodSchema) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      return c.json({
        code: 'ValidationError',
        message: 'Datos inválidos',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      }, 422);
    }
  });
