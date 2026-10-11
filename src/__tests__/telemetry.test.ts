import { beforeAll, describe, expect, it } from 'vitest';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createApp } from '../interface/http/app.js';

// El span de servidor de cada petición: ruta con plantilla, quién la hizo y, si falla con un 500, la excepción con su pila.
// Se prueba con el SDK real y una aplicación con casos de uso de mentira: lo que importa es el cableado de app.ts.
const exporter = new InMemorySpanExporter();
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://colector:4318'; // lo que activa el middleware (como en producción)
  const getInvoice = {
    execute: async (_org: string, id: string) => {
      if (id === 'boom') throw new Error('falla interna');
      if (id === 'nf') throw Object.assign(new Error('no existe'), { name: 'InvoiceNotFoundError', statusCode: 404 });
      return { id };
    },
  };
  app = createApp({ useCases: { getInvoice } as never, corsOrigin: '*' });
});

const headers = { 'x-organization-id': 'org-1', 'x-user-id': 'user-1', 'x-permissions': 'invoice:read' };
const servidor = () => exporter.getFinishedSpans().filter((s) => s.kind === 1);

describe('telemetría de billing-service', () => {
  it('el span de servidor usa la plantilla de ruta y lleva organización y usuario (los pone el gateway, no el cliente)', async () => {
    exporter.reset();
    const res = await app.request('/invoices/6f9619ff-8b86-4d11-b42d-00c04fc964ff', { headers });
    expect(res.status).toBe(200);
    const spans = servidor();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toContain('/invoices/:id');
    expect(spans[0].attributes['app.org_id']).toBe('org-1');
    expect(spans[0].attributes['app.user_id']).toBe('user-1');
  });

  it('un 500 deja UNA excepción con su pila y el span en error', async () => {
    exporter.reset();
    const res = await app.request('/invoices/boom', { headers });
    expect(res.status).toBe(500);
    const [span] = servidor();
    expect(span.status.code).toBe(2);
    const excepciones = span.events.filter((e) => e.name === 'exception');
    expect(excepciones).toHaveLength(1);
    expect(excepciones[0].attributes?.['exception.message']).toBe('falla interna');
    expect(excepciones[0].attributes?.['exception.stacktrace']).toBeTruthy();
  });

  it('un 4xx de negocio (no encontrado) NO cuenta como error del servidor: es una respuesta normal y llenaría Exceptions', async () => {
    exporter.reset();
    const res = await app.request('/invoices/nf', { headers });
    expect(res.status).toBe(404);
    const [span] = servidor();
    expect(span.events.some((e) => e.name === 'exception')).toBe(false);
    expect(span.status.code).not.toBe(2);
    expect(span.attributes['http.response.status_code']).toBe(404);
  });

  it('un 403 (sin organización) tampoco es un error del servidor', async () => {
    exporter.reset();
    const res = await app.request('/invoices/x', { headers: {} });
    expect(res.status).toBe(403);
    const [span] = servidor();
    expect(span.status.code).not.toBe(2);
  });
});
