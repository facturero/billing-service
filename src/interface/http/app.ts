import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { httpInstrumentationMiddleware } from '@hono/otel';
import { trace } from '@opentelemetry/api';
import { healthRoutes, invoiceRoutes, AppDependencies } from './routes.js';


export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    app.use('*', httpInstrumentationMiddleware({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'billing-service',
      captureRequestHeaders: ['x-request-id'],
      // Sin `spanNameFactory` a propósito: el nombre por defecto usa la plantilla de ruta (/invoices/:id). Con el path real
      // cada factura sería un nombre de span distinto y SigNoz no podría agrupar nada.
    }));
  }
  // Quién hizo la petición, en el span de servidor. Mismos nombres que usa el frontend (app.org_id / app.user_id): con ellos
  // se filtra una organización o una persona de punta a punta, del navegador al servicio. Los pone el gateway (JWT), no el cliente.
  app.use('*', async (c, next) => {
    const span = trace.getActiveSpan();
    if (span) {
      const org = c.req.header('x-organization-id');
      const user = c.req.header('x-user-id');
      if (org) span.setAttribute('app.org_id', org);
      if (user) span.setAttribute('app.user_id', user);
    }
    await next();
  });

  app.use('*', cors({ origin: deps.corsOrigin }));

  // Nota: en Hono ^4 el error global debe registrarse en `onError`, no como
  // middleware: un app.use con try/catch NO ve las excepciones de los route
  // handlers (hono-base las desvía a onError en handleError). Dejarlo como
  // middleware hacía que todo error (p.ej. ProductNotFoundError) respondiera 500.
  app.onError(async (err: any, c) => {
    const status = err.statusCode || 500;
    const code = err.name || 'InternalError';
    const message = err.message || 'Error interno del servidor';
    if (status === 500) {
      console.error('[billing] Error:', err);
    } else {
      // `@hono/otel` marca como error del span (y registra la excepción) todo lo que llegue a `onError`, incluso un 404 o una
      // validación fallida. Eso llenaría la pestaña Exceptions y la tasa de errores de SigNoz con respuestas NORMALES de negocio.
      // Se limpia aquí: en el servidor solo los 5xx son errores. El 4xx que ve la persona queda marcado en la traza del navegador.
      c.error = undefined;
    }
    return c.json({ code, message, details: err.details || null }, status);
  });

  app.route('/', healthRoutes());
  app.route('/', invoiceRoutes(deps));

  return app;
}
