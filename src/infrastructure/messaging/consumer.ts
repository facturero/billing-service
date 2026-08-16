import amqp from 'amqplib';
import type { ConsumeMessage } from 'amqplib';
import { config } from '../config.js';
import { ProcessedEventModel } from '../persistence/models.js';
import { sequelize } from '../persistence/sequelize.js';
import { resolveDocumentGenerators, type InvoiceIssuedEvent } from '../../application/documents/registry.js';
import { HttpDocumentStorage } from '../http/document-storage.js';

const documentStorage = new HttpDocumentStorage(
  config.DOCUMENT_SERVICE_URL,
  config.INTERNAL_SERVICE_SECRET,
);

async function handleInvoiceIssued(msg: ConsumeMessage, channel: amqp.Channel): Promise<void> {
  const eventId = msg.properties.headers?.eventId as string | undefined;

  if (eventId) {
    const exists = await ProcessedEventModel.findByPk(eventId);
    if (exists) { channel.ack(msg); return; }
  }

  const payload: InvoiceIssuedEvent = JSON.parse(msg.content.toString());

  const generators = resolveDocumentGenerators(payload.countryCode);
  if (generators.length === 0) {
    console.log(`[billing][documents] Sin generadores registrados para el pais ${payload.countryCode}, no se genera nada`);
    channel.ack(msg);
    return;
  }

  for (const gen of generators) {
    try {
      console.log(`[billing][documents] Generando ${gen.key} para factura ${payload.number}...`);
      const buffer = await gen.render(payload);
      await documentStorage.upload({
        resourceId: payload.invoiceId,
        category: 'comprobante',
        originalName: `factura-${payload.number}.${gen.fileExtension}`,
        mimeType: gen.mimeType,
        buffer,
      });
      console.log(`[billing][documents] ${gen.key} subido correctamente`);
    } catch (err) {
      console.error(`[billing][documents] Error generando/subiendo ${gen.key}:`, err);
      channel.nack(msg, false, true);
      return;
    }
  }

  if (eventId) {
    await ProcessedEventModel.findOrCreate({
      where: { event_id: eventId },
      defaults: { event_id: eventId, processed_at: new Date() },
    });
  }

  channel.ack(msg);
}

export async function startConsumers(): Promise<void> {
  if (!config.RABBITMQ_URL) {
    console.log('[billing-service] RABBITMQ_URL no configurado, consumidores desactivados.');
    return;
  }

  try {
    const connection = await amqp.connect(config.RABBITMQ_URL);
    const channel = await connection.createChannel();
    const exchange = 'crm.events';
    await channel.assertExchange(exchange, 'topic', { durable: true });

    const queue = 'billing-service.invoice-documents';
    await channel.assertQueue(queue, { durable: true });
    await channel.bindQueue(queue, exchange, 'billing.invoice.issued');
    await channel.consume(queue, (msg) => {
      if (!msg) return;
      handleInvoiceIssued(msg, channel).catch((err) => {
        console.error('[billing-service] Error procesando billing.invoice.issued:', err);
        channel.nack(msg, false, true);
      });
    });

    console.log('[billing-service] Consumidor de documentos de RabbitMQ iniciado.');
  } catch (err) {
    console.error('[billing-service] Error al conectar consumidor con RabbitMQ:', err);
  }
}
