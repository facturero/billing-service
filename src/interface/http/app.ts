import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes, invoiceRoutes, AppDependencies } from './routes.js';
import { errorHandler } from './middlewares.js';

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.use('*', cors({ origin: deps.corsOrigin }));
  app.use('*', errorHandler());

  app.route('/', healthRoutes());
  app.route('/', invoiceRoutes(deps));

  return app;
}
