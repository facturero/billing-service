import { InboxConsumer, EventHandler } from '@facturero/outbox-relay';
import { config } from '../config.js';
import { sequelize } from '../persistence/sequelize.js';
import { resolveDocumentGenerators, type InvoiceIssuedEvent } from '../../application/documents/registry.js';
import { HttpDocumentStorage } from '../http/document-storage.js';

const documentStorage = new HttpDocumentStorage(
  config.DOCUMENT_SERVICE_URL,
  config.INTERNAL_SERVICE_SECRET,
);

export const invoiceIssuedHandler: EventHandler = {
  eventType: 'billing.invoice.issued',
  async handle(payload: unknown): Promise<void> {
    const event = payload as InvoiceIssuedEvent;

    const generators = resolveDocumentGenerators(event.countryCode);
    if (generators.length === 0) {
      console.log(`[billing][documents] Sin generadores registrados para el pais ${event.countryCode}, no se genera nada`);
      return;
    }

    for (const gen of generators) {
      console.log(`[billing][documents] Generando ${gen.key} para factura ${event.number}...`);
      const buffer = await gen.render(event);
      await documentStorage.upload({
        resourceId: event.invoiceId,
        category: 'comprobante',
        originalName: `factura-${event.number}.${gen.fileExtension}`,
        mimeType: gen.mimeType,
        buffer,
      });
      console.log(`[billing][documents] ${gen.key} subido correctamente`);
    }
  },
};

export async function startConsumers(): Promise<void> {
  if (!config.RABBITMQ_URL) {
    console.log('[billing-service] RABBITMQ_URL no configurado, consumidores desactivados.');
    return;
  }

  try {
    const consumer = new InboxConsumer({
      sequelize,
      rabbitmqUrl: config.RABBITMQ_URL,
      exchange: 'crm.events',
      queue: 'billing-service.invoice-documents',
      bindings: ['billing.invoice.issued'],
      handlers: [invoiceIssuedHandler],
    });
    await consumer.start();
    console.log('[billing-service] Consumidor de documentos de RabbitMQ iniciado.');
  } catch (err) {
    console.error('[billing-service] Error al conectar consumidor con RabbitMQ:', err);
  }
}
