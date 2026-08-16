import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import { UnauthorizedError } from '../../domain/errors.js';

export interface ContextVariables {
  userId: string;
  userEmail: string;
  organizationId: string;
  countryCode: string;
  permissions: string[];
}

export function requireOrganization() {
  return createMiddleware(async (c, next) => {
    const orgId = c.req.header('X-Organization-Id');
    if (!orgId) {
      throw new UnauthorizedError('Falta X-Organization-Id');
    }
    c.set('organizationId', orgId);
    c.set('userId', c.req.header('X-User-Id') || '');
    c.set('userEmail', c.req.header('X-User-Email') || '');
    c.set('countryCode', c.req.header('X-Country-Code') || 'EC');
    const perms = c.req.header('X-Permissions');
    c.set('permissions', perms ? perms.split(',') : []);
    await next();
  });
}

export function requirePermission(permission: string) {
  return createMiddleware(async (c, next) => {
    const permissions = c.get('permissions') as string[];
    if (permission && !permissions.includes(permission) && !permissions.includes('*')) {
      throw new UnauthorizedError(`Permiso requerido: ${permission}`);
    }
    await next();
  });
}

export function errorHandler() {
  return async (c: Context, next: () => Promise<void>) => {
    try {
      await next();
    } catch (err: any) {
      const status = err.statusCode || 500;
      const code = err.name || 'InternalError';
      const message = err.message || 'Error interno del servidor';
      if (status === 500) {
        console.error('[billing] Error:', err);
      }
      return c.json({ code, message, details: err.details || null }, status);
    }
  };
}
