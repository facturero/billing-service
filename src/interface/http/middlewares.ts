import { createMiddleware } from 'hono/factory';
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
