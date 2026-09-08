import { createMiddleware } from 'hono/factory';
import { runWithActor } from '@facturero/outbox-relay';
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
    // Quien actúa viaja en un contexto asíncrono hasta el outbox: así CADA
    // evento publicado durante esta petición lleva actor/ip/request-id sin que
    // los casos de uso tengan que arrastrarlos uno a uno. Ver `withActor`.
    await runWithActor(
      {
        actorId: c.req.header('X-User-Id') ?? null,
        actorEmail: c.req.header('X-User-Email') ?? null,
        actorIp: c.req.header('X-Client-Ip') ?? null,
        requestId: c.req.header('X-Request-Id') ?? null,
      },
      () => next(),
    );
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
