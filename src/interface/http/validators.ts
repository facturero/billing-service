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
