import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes, invoiceRoutes, AppDependencies } from './routes.js';


export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

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
    }
    return c.json({ code, message, details: err.details || null }, status);
  });

  app.route('/', healthRoutes());
  app.route('/', invoiceRoutes(deps));

  return app;
}
