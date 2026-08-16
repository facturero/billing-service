# Generación asíncrona de documentos por factura (PDF/XML)

> **Para el agente (opencode):** sigue las fases en orden. Cada una depende de la anterior.
> **Fuera de alcance:** el XML que se genera acá es una **representación estructurada genérica** de la factura, NO el esquema oficial del SRI, y el PDF es una representación imprimible simple, NO el RIDE oficial con clave de acceso/código de barras. Cuando se aborde el proyecto de integración real con el SRI, ese trabajo reemplaza el generador de XML de este documento — la tubería asíncrona (evento → generar → guardar) queda igual.

## 0. Objetivo y por qué la arquitectura es así

Cuando una factura pasa a `issued`, hay que producir un PDF y un XML (y a futuro, cualquier otro documento que pida una institución) y guardarlos. Esto **no debe bloquear la respuesta de `POST /invoices/:id/issue`** — ya generamos y guardamos el número/totales ahí, pero renderizar documentos es trabajo pesado y no debe demorar al usuario ni fallar la emisión si el renderizado falla.

La pieza que hace esto posible **ya existe a medias**: `issue-invoice.ts` ya escribe una fila en `outbox_messages` con el evento `billing.invoice.issued` (patrón Outbox). El problema es que **nadie la publica todavía** — la fila queda ahí para siempre. Cada microservicio de este monorepo que sí publica outbox tiene un `OutboxRelay` (ver `organization-service/src/infrastructure/messaging/relay.ts`) que hace polling de `outbox_messages` cada 5s y publica a RabbitMQ, exchange `crm.events` (topic), routing key = `type` del evento. billing-service no tiene el suyo. Fase 1 lo agrega, copiando el patrón tal cual.

Una vez que el evento se publica de verdad, billing-service **también** puede consumirlo (sí, el mismo servicio publica y consume — es el dueño de los datos de factura, es el único que sabe armar el PDF/XML). El consumo pasa por RabbitMQ, así que corre en un flujo completamente separado del ciclo request/response HTTP: no hay forma de que bloquee `/issue`.

## 1. Prerrequisito bloqueante: document-service no puede recibir archivos hoy

Reviosé `document-service` a fondo: el único flujo implementado es el de **presigned upload para navegadores** (`POST /files/presigned` → el navegador sube directo a S3/MinIO con la URL). En desarrollo local, la ruta que debería recibir ese PUT (`/local-storage/upload/:token`, ver `LocalStorageAdapter.generatePresignedUploadUrl`) **no está registrada en ningún router** — es código muerto, igual que encontramos antes en billing-service. Hoy, ningún archivo puede terminar de subirse de punta a punta en local.

Además, esa danza de presigned-URL tiene sentido para navegadores (evitar que el binario pase por el servidor de aplicación), pero **no tiene sentido para una llamada servidor-a-servidor** como la que va a hacer billing-service — billing-service ya tiene los bytes del PDF/XML en memoria, no necesita una URL pre-firmada para subírselos a sí mismo.

### 1.1 Nuevo endpoint interno: `POST /files/internal`

- [ ] En `document-service/src/interface/http/routes.ts`, agregar:
  ```ts
  r.post('/files/internal', internalAuthMiddleware(), createInternalFileController(useCases.createInternalFile));
  ```
- [ ] `internalAuthMiddleware()` (nuevo, en `middlewares.ts`): en vez de validar un JWT de usuario, valida una cabecera `X-Internal-Secret` contra `config.INTERNAL_SERVICE_SECRET` (nueva env var, un string compartido entre billing-service y document-service — **no** es el JWT del gateway, esto es tráfico servicio-a-servicio que no pasa por el gateway). Si no coincide, `401`.
- [ ] Request: `multipart/form-data` con campos `resourceType`, `resourceId`, `category`, `originalName`, `mimeType`, `uploadedBy` (string libre, ej. `'billing-service'`) y el archivo binario en el campo `file`.
- [ ] Nuevo caso de uso `CreateInternalFileUseCase` (`application/use-cases/create-internal-file.ts`):
  ```ts
  export class CreateInternalFileUseCase {
    constructor(private readonly uow: UnitOfWork, private readonly storage: StoragePort, private readonly storageBucket: string) {}

    async execute(input: { resourceType: string; resourceId: string; category: string; originalName: string; mimeType: string; uploadedBy: string; buffer: Buffer; }): Promise<FileResponseDTO> {
      return this.uow.execute(async (repos) => {
        const storageKey = `${input.resourceType}/${input.resourceId}/${crypto.randomUUID()}-${input.originalName}`;
        const checksum = crypto.createHash('sha256').update(input.buffer).digest('hex');

        // Escribe el binario directo (sin la danza de presigned-URL, es tráfico interno)
        await this.storage.putObjectDirect(storageKey, input.buffer, input.mimeType);

        let file = FileReference.create({
          resourceType: input.resourceType, resourceId: input.resourceId,
          category: input.category.toLowerCase(), originalName: input.originalName,
          mimeType: input.mimeType, size: input.buffer.length,
          storageKey, storageBucket: this.storageBucket, checksum: '',
          description: null, expiresAt: null, parentId: null, uploadedBy: input.uploadedBy,
        });
        file = file.confirm(checksum); // pasa directo a 'confirmed', sin escaneo (contenido generado internamente, no subido por un usuario)

        await repos.files.save(file);
        return toFileResponseDTO(file);
      });
    }
  }
  ```
- [ ] Agregar `putObjectDirect(key, buffer, contentType): Promise<void>` a `StoragePort` (`application/ports.ts`) e implementarlo en `LocalStorageAdapter` (escritura directa con `fs/promises.writeFile`, creando el directorio con `mkdir recursive`) y en `S3StorageAdapter` (un `PutObjectCommand` directo, sin presigned URL).
- [ ] Config nueva en `document-service/src/infrastructure/config.ts`: `INTERNAL_SERVICE_SECRET: z.string().default('dev-internal-secret-change-me')`.

- [ ] Hecho. Con esto, cualquier servicio interno (billing-service en este caso) puede subir un archivo ya generado en un solo call, sin pasar por el flujo de navegador.

## 2. `OutboxRelay` en billing-service (copiar patrón exacto)

- [ ] Nuevo archivo `billing-service/src/infrastructure/messaging/relay.ts` — copiar `organization-service/src/infrastructure/messaging/relay.ts` literal (mismo exchange `crm.events`, mismo polling de 5s sobre `outbox_messages`). No hace falta cambiar nada, la tabla `outbox_messages` de billing-service ya tiene exactamente las mismas columnas.
- [ ] En `billing-service/src/main.ts`, después de levantar el servidor HTTP:
  ```ts
  if (config.RABBITMQ_URL) {
    const relay = new OutboxRelay();
    await relay.start(config.RABBITMQ_URL);
  } else {
    console.log('[billing-service] RABBITMQ_URL no configurado, outbox relay desactivado.');
  }
  ```
- [ ] Confirmar que `docker-compose.yml` ya inyecta `RABBITMQ_URL` a billing-service (revisar el anchor `&billing-env`; si falta, agregarlo igual que en los demás servicios) y agregar default local en `config.ts` si se quiere correr fuera de Docker: `RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672')`.

- [ ] Hecho. Verificar manualmente: emitir una factura, y en los logs de billing-service debería aparecer la publicación (o, más fácil, conectarse a la UI de management de RabbitMQ — `http://localhost:15672` si está expuesta — y ver el mensaje en el exchange `crm.events`).

## 3. Consumer + generador de documentos en billing-service

### 3.1 Tabla de idempotencia

- [ ] Nueva migración `billing-service/migrations/<timestamp>-create-processed-events.cjs`, igual patrón que `ProcessedEventModel` de customer-service:
  ```js
  await queryInterface.createTable('processed_events', {
    event_id: { type: Sequelize.CHAR(36), primaryKey: true },
    processed_at: { type: Sequelize.DATE, allowNull: false },
  });
  ```
- [ ] Nuevo modelo `ProcessedEventModel` en `infrastructure/persistence/models.ts`, mismo shape que el de customer-service.

### 3.2 Consumer

- [ ] Nuevo archivo `billing-service/src/infrastructure/messaging/consumer.ts`, mismo patrón que `customer-service/src/infrastructure/messaging/consumer.ts`:
  - Conecta a `RABBITMQ_URL`, exchange `crm.events` (topic).
  - Queue `billing-service.invoice-documents`, bind a routing key `billing.invoice.issued`.
  - Handler `handleInvoiceIssued(msg, channel)`:
    1. Chequea `processed_events` por `msg.properties.headers.eventId` — si ya existe, `channel.ack(msg)` y listo (idempotencia, evita regenerar documentos si RabbitMQ reentrega el mensaje).
    2. Parsea el payload (ya trae **todo** lo necesario: `countryCode`, `number`, `issuerSnapshot`, `customerSnapshot`, `lines` con sus `taxes`, `subtotalCents`, `taxTotalCents`, `totalCents`, `currencyCode` — no hace falta volver a consultar la base de billing_db).
    3. **Resuelve qué generadores le corresponden a `payload.countryCode`** (ver 3.2.1) — si no hay ninguno registrado para ese país, loguea `[billing][documents] Sin generadores registrados para el país ${countryCode}, no se genera nada` y hace `channel.ack(msg)` sin generar ni subir absolutamente nada. Esto es intencional: no se ejecuta ningún generador "por defecto" ni se asume que un formato genérico sirve para cualquier país.
    4. Para cada generador resuelto: genera el documento y lo sube a document-service (ver 3.3–3.5).
    5. Inserta la fila en `processed_events`.
    6. `channel.ack(msg)`.
    7. Si algo falla en 3–4: `channel.nack(msg, false, true)` (reintenta) y loguea con `console.error`. No relanzar hacia arriba de forma que tumbe el proceso.
- [ ] En `main.ts`, llamar `startConsumers()` (análogo a customer-service) junto al arranque del `OutboxRelay`.

### 3.2.1 Registro de generadores por país (evita ejecutar lógica que no corresponde)

**Esto es lo importante que había que resolver: nada de esto corre "siempre", corre solo para el país que realmente lo necesita.**

- [ ] Nuevo archivo `billing-service/src/application/documents/registry.ts`:
  ```ts
  export interface DocumentGenerator {
    key: string; // ej. 'ec-generic-pdf', 'ec-generic-xml'
    mimeType: string;
    fileExtension: string;
    render(payload: InvoiceIssuedEvent): Promise<Buffer> | Buffer;
  }

  const REGISTRY: Record<string, DocumentGenerator[]> = {
    EC: [
      { key: 'ec-generic-pdf', mimeType: 'application/pdf', fileExtension: 'pdf', render: renderInvoicePdf },
      { key: 'ec-generic-xml', mimeType: 'application/xml', fileExtension: 'xml', render: (p) => Buffer.from(renderInvoiceXml(p), 'utf-8') },
    ],
    // PE, CO, etc. se agregan acá el día que haya un generador real para ese país.
    // Mientras no exista una entrada, ese país NO genera ningún documento — no hay fallback genérico.
  };

  export function resolveDocumentGenerators(countryCode: string): DocumentGenerator[] {
    return REGISTRY[countryCode] ?? [];
  }
  ```
- [ ] **Regla dura:** el PDF/XML "genérico" que describe la sección 3.3/3.4 de este documento está registrado **solo bajo `EC`**, no como fallback universal. No agregar una entrada `default`/`*` en el registry — si mañana se factura para otro país sin generador propio, el comportamiento correcto es no generar nada (y quedar logueado), no generar un PDF genérico que nadie pidió ni validó para ese país.
- [ ] Cuando se implemente la integración real del SRI (fuera de alcance de este documento, ver sección 5), lo que cambia es el contenido de las funciones `render` bajo la clave `EC` — la clave `PE`/`CO`/etc. para otros países se agrega como una entrada nueva e independiente en este mismo registry, con sus propios generadores (que van a tener reglas totalmente distintas: SUNAT no es SRI). Nunca se comparte lógica de generación entre países distintos a través de este registry — cada entrada es aislada.

### 3.3 Generador de PDF

- [ ] Agregar dependencia `pdfkit` a `package.json` (`npm install pdfkit @types/pdfkit --save`).
- [ ] Nuevo archivo `billing-service/src/application/documents/render-invoice-pdf.ts`, función pura `renderInvoicePdf(payload: InvoiceIssuedEvent): Promise<Buffer>` que arma un PDF simple y legible con:
  - Encabezado: `issuerSnapshot.legalName` / `taxId`, número de factura, fecha.
  - Datos del cliente: `customerSnapshot.businessName` / `identification`.
  - Tabla de líneas: descripción, cantidad, precio unitario, subtotal.
  - Totales: subtotal, IVA (desglosado por tasa si hay más de una), total.
  - Pie: nota de que es una representación interna, no el comprobante oficial del SRI (texto chico, ej. *"Documento interno — no válido como comprobante tributario"* hasta que se implemente la integración oficial).
  - Usar `PDFDocument` de `pdfkit`, acumular en un buffer vía el patrón estándar (`doc.on('data', chunk =>...)`, `doc.on('end', ...)`, `doc.end()`), envuelto en una `Promise`.

### 3.4 Generador de XML

- [ ] Nuevo archivo `billing-service/src/application/documents/render-invoice-xml.ts`, función pura `renderInvoiceXml(payload: InvoiceIssuedEvent): string` que arma un XML **genérico propio** (no el esquema del SRI), por ejemplo:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <invoice schemaVersion="generic-v1">
    <number>...</number>
    <issuer><legalName/><taxId/></issuer>
    <customer><businessName/><identification/></customer>
    <lines>
      <line><description/><quantity/><unitPrice/><subtotal/><taxes>...</taxes></line>
    </lines>
    <totals><subtotal/><tax/><total/></totals>
  </invoice>
  ```
  Sin dependencias externas — armar el string a mano con los valores escapados (reemplazar `&`, `<`, `>` en campos de texto libre como `businessName`/`description` para evitar XML inválido).

### 3.5 Subida a document-service

- [ ] Nuevo puerto en `application/ports.ts`: `DocumentStoragePort` con `upload(params: { resourceId: string; category: string; originalName: string; mimeType: string; buffer: Buffer }): Promise<void>`.
- [ ] Implementación `infrastructure/http/document-storage.ts` → `HttpDocumentStorage`: arma un `FormData` (usar `undici`'s `FormData`/`Blob`, ya disponibles globalmente en Node ≥20) y hace `POST ${DOCUMENT_SERVICE_URL}/files/internal` con header `X-Internal-Secret` (misma config nueva del lado de billing-service: `INTERNAL_SERVICE_SECRET`) y `resourceType: 'invoice'`.
- [ ] Config nueva en `billing-service/config.ts`: `DOCUMENT_SERVICE_URL: z.string().default('http://document-service:3003')`, `INTERNAL_SERVICE_SECRET: z.string().default('dev-internal-secret-change-me')` (debe ser el mismo valor configurado en document-service — documentarlo bien en ambos `.env.example`).
- [ ] Desde el consumer (3.2), llamar:
  ```ts
  await documentStorage.upload({ resourceId: payload.invoiceId, category: 'comprobante', originalName: `factura-${payload.number}.pdf`, mimeType: 'application/pdf', buffer: pdfBuffer });
  await documentStorage.upload({ resourceId: payload.invoiceId, category: 'comprobante', originalName: `factura-${payload.number}.xml`, mimeType: 'application/xml', buffer: Buffer.from(xmlString, 'utf-8') });
  ```

- [ ] Hecho. Emitir una factura, esperar unos segundos, y confirmar con `GET /files?resourceType=invoice&resourceId=<id>&category=comprobante` (vía gateway, con tu JWT normal — esa ruta sí exige auth de usuario) que aparezcan los 2 archivos.

## 4. Frontend: mostrar los documentos generados

- [ ] En `InvoiceDetailView.vue`, cuando `status !== 'draft'`, agregar una sección "Documentos" que hace `GET /files?resourceType=invoice&resourceId=<id>` (nuevo método en `api/invoices.ts` o un `api/documents.ts` genérico) y lista los archivos con un botón de descarga por cada uno (`GET /files/:id/download`, esa ruta ya es pública en el gateway — hace un 302 a la URL firmada).
- [ ] Como la generación es asíncrona (puede tardar unos segundos después de emitir), si la lista viene vacía mostrar un mensaje tipo *"Generando documentos…"* y reintentar automáticamente cada 3s hasta 5 intentos (polling simple, sin WebSocket — no hay que sobre-ingenierizar esto para un MVP).

## 5. Pendiente explícitamente fuera de este documento

- Contenido real del XML según el esquema oficial del SRI (factura v2.1.0, claves de acceso, etc.).
- Firma electrónica XAdES-BES.
- Envío a los web services de recepción/autorización del SRI.
- RIDE oficial (PDF con código de barras/QR y clave de acceso).

Cuando se aborde ese proyecto, el punto de reemplazo es exactamente `render-invoice-pdf.ts` y `render-invoice-xml.ts` — el resto de la tubería (evento → consumer → subida a document-service → mostrar en el front) queda igual.

## Checklist de aceptación final

1. Emitir una factura no tarda perceptiblemente más que antes (la generación de documentos ocurre después de que `/issue` ya respondió).
2. A los pocos segundos de emitir, `GET /files?resourceType=invoice&resourceId=<id>` devuelve un PDF y un XML.
3. El PDF se puede descargar y abre correctamente, con los datos reales de la factura.
4. Si se reinicia billing-service justo después de emitir (antes de que el consumer procese el evento), al volver a levantar el servicio el documento se genera igual (no se pierde por el restart — la fila sigue en `outbox_messages`/la cola de RabbitMQ es durable).
5. Si se fuerza que el mismo evento se entregue dos veces (redelivery), no se generan documentos duplicados (por `processed_events`).
6. Si se emite una factura con `countryCode` distinto a `EC` (hoy no debería pasar en la práctica, pero probálo forzando el dato), **no se genera ni se sube ningún archivo**, y en los logs aparece el mensaje de "sin generadores registrados" — no un PDF/XML genérico ni un error.
