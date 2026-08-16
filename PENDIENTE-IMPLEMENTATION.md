# billing-service — Pendiente de implementación

> **Para el agente (opencode):** este documento es la fuente de verdad de la tarea. Sigue las fases **en orden** — cada una depende de la anterior. **Imita los patrones que ya existen en el repo**: mismo estilo de entidad, error, repositorio, caso de uso, controlador y wiring en `main.ts`. No inventes una arquitectura nueva. Marca cada checkbox al completarlo.
>
> **Fuera de alcance (explícitamente NO hacer en este documento):** nada de SRI — no generar XML de comprobante, no firmar (XAdES-BES), no enviar a los web services del SRI, no manejar claves de acceso ni autorización fiscal. `issue-invoice.ts` sigue siendo, al terminar este documento, una emisión **local/comercial** (borrador → emitido con folio secuencial). La integración real con SRI es un documento aparte.
>
> **Motivación:** hoy `POST /invoices/:id/issue` **siempre falla**. Hay tres bloqueos apilados (snapshots nunca seteados, read-models nunca poblados, no existe ningún `Sequence`) más una serie de huecos menores (impuestos agregados, validaciones, un bug de cálculo con impuestos múltiples). Este documento cubre todo eso.

---

## 0. Contexto y reglas de oro

**Stack real (no cambiar):** Node ≥20, TypeScript strict, `type: module`, Hono, Sequelize + `mysql2` (base `billing_db`), Dinero.js v2, Zod, Clean Architecture (`domain ← application ← infrastructure/interface`).

**Reglas de oro:**

1. Los casos de uso viven en `src/application/use-cases/`, reciben sus dependencias por constructor (nunca importan infraestructura directo). Ver `add-line.ts` como ejemplo ya corregido de este patrón (recibe `UnitOfWork`, `ProductCatalogPort`, `TaxRatePort`).
2. Los "puertos" hacia otros microservicios van en `src/application/ports.ts` (interfaces) + implementación HTTP en `src/infrastructure/http/*.ts`. Ya existen dos ejemplos completos a imitar exactamente en estilo:
   - `src/application/ports.ts` → `ProductCatalogPort`, `TaxRatePort`
   - `src/infrastructure/http/product-catalog.ts` → `HttpProductCatalog`
   - `src/infrastructure/http/tax-rate-catalog.ts` → `HttpTaxRateCatalog`
3. billing-service llama a los otros servicios **directo, sin pasar por el gateway** (server-to-server). Por eso cada cliente HTTP tiene que poner **manualmente** las cabeceras que cada servicio espera del gateway. Todos los servicios de este monorepo usan el mismo `contextMiddleware`, así que las cabeceras son siempre las mismas:
   - `X-Organization-Id`: el `organizationId` de la operación en curso.
   - `X-Permissions`: string separado por comas con los códigos de permiso que la ruta destino exige (ver `x-required-permission` en cada `openapi.yaml`). Como es una llamada interna de servicio a servicio, no de un usuario, se manda el permiso que haga falta directamente (mismo patrón que ya usan `HttpProductCatalog` con `'product:read'` y `product-service`'s `TaxRateHttpRepository` con `X-User-Id`).
   - `X-User-Id`: algunos servicios (tax-service) solo exigen esta cabecera (`requireUser()`, sin permiso). Mandar un valor fijo tipo `'billing-service'` (ya se hace así en `HttpTaxRateCatalog`).
4. Todos los clientes HTTP nuevos deben ser **best-effort y con logging explícito**, replicando el patrón ya establecido en `HttpProductCatalog`/`HttpTaxRateCatalog`: si el servicio no responde o da error, no tirar una excepción no controlada — loguear con `console.warn` y dejar que el caller decida (lanzar el error de dominio correspondiente, o devolver `null`/`[]` si aplica). Un problema de red puntual en un servicio interno no debe tirar un 500 genérico sin contexto.
5. Cualquier tabla/columna nueva va en una migración nueva de `sequelize-cli` (no editar migraciones ya aplicadas). Nomenclatura: `YYYYMMDDHHmmss-descripcion.cjs`, imitando `migrations/20260713000000-create-billing-tables.cjs`.
6. Tras cada fase: `npm run typecheck` debe pasar. Si tocas algo que tenga test existente en `src/__tests__/`, correlo. Añade tests nuevos para cada caso de uso nuevo o reescrito (ver Fase 6).

---

## 1. Puertos hacia organization-service y customer-service

**Por qué:** para armar `issuerSnapshot` (organization-service) y `customerSnapshot` (customer-service), y para resolver establecimiento/punto de emisión reales al emitir.

### 1.1 Endpoints reales a consumir (confirmados leyendo el código fuente de cada servicio — no asumir nada distinto)

| Servicio | Método + ruta | Headers requeridos | Permiso |
|---|---|---|---|
| organization-service | `GET /organizations/me` | `X-Organization-Id` | `organization:read` |
| organization-service | `GET /establishments` | `X-Organization-Id` | `establishment:read` |
| organization-service | `GET /establishments/:id/billing-points` | `X-Organization-Id` | `establishment:read` |
| customer-service | `GET /customers/:id` | `X-Organization-Id` | `customer:read` |

> ⚠️ **Ojo:** `src/infrastructure/persistence/read-models.ts` tiene una función `populateReadModels()` que **ya existe pero está mal** — llama a `${orgServiceUrl}/establishments?organizationId=${organizationId}` (sin cabecera `X-Organization-Id`, pasando el id como query param que org-service ni siquiera lee) y a `${orgServiceUrl}/emission-points?organizationId=...` (la ruta real es `/establishments/:id/billing-points`, anidada, no existe `/emission-points` como ruta plana). Es código muerto que nunca funcionó. **Bórrala** junto con toda `populateReadModels` y la tabla de lectura in-memory que la acompaña (`ReadModelRepository`/`GenericRepository` en `domain/repositories.ts` e `infrastructure/persistence/read-models.ts`) — se reemplaza completo por los puertos on-demand de este documento (mismo patrón que `ProductCatalogPort`/`TaxRatePort`, sin cache en memoria de "toda la organización", solo consulta puntual + cache corta por id como hace `HttpTaxRateCatalog`).

### 1.2 Nuevo puerto: `OrganizationCatalogPort` (`src/application/ports.ts`)

```ts
export interface IssuerInfo {
  legalName: string;
  tradeName: string | null;
  taxId: string;
}

export interface EstablishmentInfo {
  id: string;
  code: string;
  name: string;
  address: string | null;
  status: string;
}

export interface EmissionPointInfo {
  id: string;
  code: string;
  name: string | null;
  status: string;
}

export interface OrganizationCatalogPort {
  getOrganization(organizationId: string): Promise<IssuerInfo | null>;
  getEstablishment(organizationId: string, establishmentId: string): Promise<EstablishmentInfo | null>;
  getEmissionPoint(organizationId: string, establishmentId: string, emissionPointId: string): Promise<EmissionPointInfo | null>;
}
```

### 1.3 Nuevo puerto: `CustomerCatalogPort` (`src/application/ports.ts`)

```ts
export interface CustomerInfo {
  id: string;
  identificationTypeId: string;
  identification: string;
  businessName: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  type: 'person' | 'company';
  status: string;
}

export interface CustomerCatalogPort {
  findById(organizationId: string, customerId: string): Promise<CustomerInfo | null>;
}
```

### 1.4 Implementaciones HTTP

- [x] `src/infrastructure/http/organization-catalog.ts` → `HttpOrganizationCatalog implements OrganizationCatalogPort`.
  - `getOrganization`: `GET ${ORG_SERVICE_URL}/organizations/me` con `X-Organization-Id` + `X-Permissions: 'organization:read'`. Mapea `{legalName, tradeName, taxId}`. Si `legalName` o `taxId` vienen `null` (organización con perfil fiscal incompleto, ver `RBAC-IMPLEMENTATION.md` §0.1 de auth-service — el perfil se completa después del registro), devolver `null` igual (no se puede emitir sin esos datos).
  - `getEstablishment`: `GET ${ORG_SERVICE_URL}/establishments` (lista completa, la API no tiene get-by-id) con mismas cabeceras + `establishment:read`, y filtrar por `id` en el array resultante. Si `status !== 'active'`, tratar como no encontrado (dejar que el caller decida si lanza `EmissionPointInactiveError`-equivalente para establecimientos, o reusar el mismo patrón).
  - `getEmissionPoint`: `GET ${ORG_SERVICE_URL}/establishments/${establishmentId}/billing-points` + mismas cabeceras, filtrar por `id`.
  - Aplica el mismo patrón de logging/try-catch que `HttpProductCatalog`.
- [x] `src/infrastructure/http/customer-catalog.ts` → `HttpCustomerCatalog implements CustomerCatalogPort`.
  - `GET ${CUSTOMER_SERVICE_URL}/customers/${customerId}` con `X-Organization-Id` + `X-Permissions: 'customer:read'`.
  - Mapear al shape de `CustomerInfo`. `taxClassification` **no existe** en la respuesta real de customer-service — no incluirlo (el campo opcional en `CustomerSnapshot` del dominio se deja en `null`/`undefined`).

### 1.5 Config (`src/infrastructure/config.ts`)

Ya existen `ORG_SERVICE_URL` y `CUSTOMER_SERVICE_URL` como opcionales sin default. Agrégales default igual que se hizo para `PRODUCT_SERVICE_URL`/`TAX_SERVICE_URL`:

```ts
ORG_SERVICE_URL: z.string().default('http://organization-service:3002'),
CUSTOMER_SERVICE_URL: z.string().default('http://customer-service:3004'),
```

### 1.6 Wiring (`src/main.ts`)

```ts
const organizationCatalog = new HttpOrganizationCatalog(config.ORG_SERVICE_URL);
const customerCatalog = new HttpCustomerCatalog(config.CUSTOMER_SERVICE_URL);
```

Pasar a los casos de uso que los necesiten (Fases 2 y 3).

- [x] Puertos, implementaciones y config listos. `npm run typecheck` pasa.

---

## 2. `customerSnapshot`: setearlo al crear (y al cambiar de cliente)

**Por qué:** `Invoice.issue()` exige `customerSnapshot` seteado. Hoy nunca se setea en ningún caso de uso — `Invoice.setCustomerSnapshot()` existe en la entidad pero es código muerto.

### 2.1 `CreateInvoiceUseCase` (`src/application/use-cases/create-invoice.ts`)

- [x] Constructor recibe también `customerCatalog: CustomerCatalogPort`.
- [x] Antes de guardar la nueva `Invoice`, llamar `customerCatalog.findById(organizationId, input.customerId)`.
  - Si devuelve `null` → `throw new CustomerNotFoundError()` (ya existe en `domain/errors.ts`, sin usar).
  - Si `status !== 'active'` → `throw new CustomerDisabledError()` (ya existe, sin usar).
  - Si todo bien, mapear a `CustomerSnapshot` (`{ id, businessName, identification, identificationTypeId, email, phone, type }`) y llamar `invoice.setCustomerSnapshot(snapshot)` **antes** de `repos.business.invoices.save(invoice)`.

### 2.2 `UpdateInvoiceUseCase` (`src/application/use-cases/update-invoice.ts`)

- [x] Mismo puerto inyectado.
- [x] Si `input.customerId` viene y es distinto al actual: repetir la misma validación + `setCustomerSnapshot` con los datos del cliente nuevo (el snapshot debe reflejar siempre al cliente vigente mientras la factura sea borrador).

### 2.3 Wiring en `main.ts`

```ts
createInvoice: new CreateInvoiceUseCase(uow, customerCatalog),
updateInvoice: new UpdateInvoiceUseCase(uow, customerCatalog),
```

- [x] Hecho. `npm run typecheck` pasa.

---

## 3. `issuerSnapshot`, establecimiento/punto de emisión reales y `Sequence` auto-provisionada — todo en `IssueInvoiceUseCase`

**Por qué:** son los 3 bloqueos que hacen fallar `issue-invoice.ts` hoy. Se resuelven juntos porque están en el mismo caso de uso y comparten los mismos datos.

### 3.1 Reescribir `src/application/use-cases/issue-invoice.ts`

Constructor: agregar `organizationCatalog: OrganizationCatalogPort`.

Reemplazar la resolución actual de establecimiento/punto de emisión (que hoy lee de `repos.readModels.establishments`/`emissionPoints`, siempre vacíos porque nunca se pueblan — ver Fase 1) por:

```ts
const establishment = await this.organizationCatalog.getEstablishment(organizationId, input.establishmentId);
if (!establishment) throw new EstablishmentNotFoundError();
if (establishment.status !== 'active') throw new EstablishmentNotFoundError(); // o un error dedicado si prefieres distinguirlo

const emissionPoint = await this.organizationCatalog.getEmissionPoint(organizationId, input.establishmentId, input.emissionPointId);
if (!emissionPoint) throw new EmissionPointNotFoundError();
if (emissionPoint.status !== 'active') throw new EmissionPointInactiveError();
```

**Issuer snapshot** — construirlo con los datos de organización + establecimiento, y setearlo en la factura **antes** de llamar `invoice.issue(...)` (que exige que ya esté seteado):

```ts
const org = await this.organizationCatalog.getOrganization(organizationId);
if (!org) throw new BadRequestError('El perfil fiscal de la organización no está completo');

invoice.setIssuerSnapshot({
  legalName: org.legalName,
  tradeName: org.tradeName,
  taxId: org.taxId,
  establishmentCode: establishment.code,
  emissionPointCode: emissionPoint.code,
  address: establishment.address,
});
```

**Customer snapshot defensivo** — si por algún motivo la factura es de antes de la Fase 2 (o el caso de uso de creación falló en setearlo por cualquier razón), no debe reventar con un error genérico de dominio poco claro. Antes de llamar `invoice.issue(...)`, si `invoice.customerSnapshot` es `null`, resolverlo ahí mismo con `customerCatalog` (inyectar también este puerto) igual que en Fase 2, y llamar `setCustomerSnapshot`. Esto hace el caso de uso resiliente sin depender de que la Fase 2 se haya ejecutado para *todas* las facturas existentes.

**Sequence auto-provisionada** — reemplazar el `throw new SequenceNotFoundError()` actual:

```ts
let sequence = await repos.business.sequences.findByOrganizationAndPoint(
  organizationId, input.emissionPointId, invoice.documentTypeId,
);
if (!sequence) {
  sequence = Sequence.create({
    organizationId,
    countryCode: invoice.countryCode,
    establishmentId: input.establishmentId,
    emissionPointId: input.emissionPointId,
    documentTypeId: invoice.documentTypeId,
  });
}
```
(el resto del flujo — `sequence.nextValue()`, `repos.business.sequences.save(sequence)` — ya existe y no cambia). Esto crea el folio la primera vez que se emite por esa combinación (org, punto de emisión, tipo de documento) y lo reutiliza después. **Decisión de diseño explícita:** no se agrega un endpoint dedicado para "crear secuencia" — se auto-provisiona en el primer uso, más simple y suficiente para esta fase. Documentar esta decisión en el `IMPLEMENTATION.md` existente cuando se actualice (Fase 7).

### 3.2 Wiring en `main.ts`

```ts
issueInvoice: new IssueInvoiceUseCase(uow, organizationCatalog, customerCatalog),
```

- [x] Hecho. Probar manualmente: crear factura → agregar línea → emitir con un `establishmentId`/`emissionPointId` que **existan de verdad** en organization-service para esa organización (ver nota en Fase 8 sobre los UUIDs hardcodeados del frontend).

---

## 4. `invoice_tax_totals`: poblar el desglose de impuestos por tipo/tasa

**Por qué:** hoy la tabla nunca se escribe (`taxTotals: []` siempre en la respuesta), aunque el total agregado por línea sí funciona. El desglose por tipo de impuesto (IVA 15%, IVA 0%, retenciones, etc. como líneas separadas) hace falta para reportes y, más adelante, para el XML del SRI.

### 4.1 Regla de agrupación

Agrupar por la combinación `(kind, rateSnapshot)` — no solo por `kind`, porque un mismo tipo (`vat`) puede tener tasas distintas en la misma factura (ej. una línea con IVA 15% y otra con IVA 0%) y deben quedar como renglones de resumen separados.

### 4.2 Dónde tocar

Extraer un helper compartido (nuevo archivo `src/application/use-cases/shared/recompute-tax-totals.ts` o similar) que reciba `allLineTaxes: LineTax[]` y devuelva los grupos `{ kind, rateSnapshot, baseCents, amountCents }[]`, para no repetir la lógica en los 3 lugares que la necesitan:

- [x] `add-line.ts`: después de recalcular `allLineTaxes`, antes de devolver el DTO:
  ```ts
  await repos.business.invoiceTaxTotals.deleteByInvoice(invoiceId);
  const groups = groupTaxTotals(allLineTaxes);
  for (const g of groups) {
    await repos.business.invoiceTaxTotals.save(InvoiceTaxTotal.create({ invoiceId, ...g }));
  }
  ```
- [x] `remove-line.ts`: mismo patrón (ya borra `invoiceTaxTotals` pero nunca las recrea — actualmente queda vacío después de cualquier `removeLine`, hay que agregar el recreate).
- [x] `issue-invoice.ts`: mismo patrón, usando `allTaxes` que ya calcula ahí (aprovechar para la validación `MismatchedTotalsError` existente, que ya sólo compara subtotal/total pero podría además verificar que el total por grupo cuadre si se quiere ser estricto — opcional).

- [x] Hecho. Verificar con un `GET /invoices/:id` que `taxTotals` ya no sea `[]` tras agregar una línea con impuesto.

---

## 5. Validaciones y correcciones que faltan

### 5.1 Bug: impuestos múltiples con `priceIncludesTax` se calculan mal

En `add-line.ts`, el loop actual calcula, **para cada impuesto del producto por separado**:
```ts
baseCents = Math.round(lineSubtotalCents / (1 + ratePercent / 100));
```
Si un producto tuviera **dos** impuestos con `priceIncludesTax: true` (ej. IVA + una retención que también se marcara así), cada uno restaría de `lineSubtotalCents` completo de forma independiente, extrayendo el impuesto dos veces sobre la misma base en vez de repartir correctamente. Hoy en la práctica los productos de este seed solo tienen un impuesto (`vat`), así que no se manifiesta, pero hay que dejarlo bien:

- [x] Si `priceIncludesTax`, calcular la tasa combinada de **todas** las tasas del producto primero (`sumRates` = suma de `rateInfo.percentage` de todas las taxes del producto), obtener una única `baseCents = lineSubtotalCents / (1 + sumRates/100)`, y repartir el impuesto total (`lineSubtotalCents - baseCents`) entre cada tasa proporcional a su porcentaje individual. Si solo hay un impuesto (caso actual), el resultado es idéntico al de hoy — este cambio no rompe nada existente, solo corrige el caso con 2+ impuestos.

### 5.2 Producto inactivo

`AddLineUseCase` ya consulta `productInfo.status` (vía `ProductCatalogPort`) pero nunca lo valida. Agregar:
```ts
if (productInfo && productInfo.status !== 'active') throw new ProductDisabledError();
```
(`ProductDisabledError` ya existe en `domain/errors.ts`, sin usar.)

### 5.3 Descuento no puede superar el subtotal de la línea

Hoy `input.discountCents` no tiene tope — si es mayor a `quantity * unitPriceCents`, `lineSubtotalCents` queda negativo y todo lo que depende de ahí (impuestos, totales) se corrompe. Agregar en `add-line.ts`:
```ts
if ((input.discountCents ?? 0) > input.quantity * unitPriceCents) {
  throw new BadRequestError('El descuento no puede ser mayor al subtotal de la línea');
}
```

### 5.4 `UpdateInvoiceUseCase` no valida `documentTypeId`

No hay validación de que el `documentTypeId` nuevo exista/sea válido para el país. Es un hueco menor — si se quiere cerrar del todo, se necesitaría un puerto hacia tax-service (`GET /countries/:code/document-types`, ya existe la ruta). Dejar como *nice-to-have*, no bloqueante para este documento.

- [x] 5.1, 5.2 y 5.3 implementados. 5.4 documentado como pendiente opcional.

---

## 6. Tests

Siguiendo la convención de `src/__tests__/` (vitest), agregar:

- [x] `create-invoice.test.ts`: crea con cliente válido → `customerSnapshot` seteado; cliente inexistente → `CustomerNotFoundError`; cliente inactivo → `CustomerDisabledError`.
- [x] `issue-invoice.test.ts`: caso feliz completo (snapshot de cliente ya existe desde creación, establecimiento y punto de emisión válidos → factura queda `issued` con número correcto); establecimiento inexistente → `EstablishmentNotFoundError`; punto de emisión inactivo → `EmissionPointInactiveError`; segunda emisión en el mismo punto usa el mismo `Sequence` incrementado (no crea uno nuevo).
- [x] `add-line.test.ts` (ampliar el existente si ya hay uno, si no crearlo): impuesto se calcula bien con `priceIncludesTax: true` y `false`; producto inactivo → `ProductDisabledError`; descuento mayor al subtotal → `BadRequestError`.
- [x] `tax-totals.test.ts` (o donde quede el helper de agrupación): dos líneas con la misma tasa se agrupan en un solo renglón; dos líneas con tasas distintas del mismo `kind` quedan separadas.

- [x] `npm test` verde (existentes + nuevos).

---

## 7. Actualizar `IMPLEMENTATION.md` (el existente, no este archivo)

Una vez todo lo anterior esté hecho:

- [x] Actualizar la sección "Key decisions" de `billing-service/IMPLEMENTATION.md` para reflejar: snapshots poblados en creación/emisión, sequences auto-provisionadas (documentar la decisión de no tener endpoint dedicado), read-models en memoria reemplazados por puertos on-demand, desglose de impuestos por `(kind, rateSnapshot)`.
- [x] Borrar de ese documento cualquier mención a `populateReadModels`/`ReadModelRepository` si quedó referenciada.

---

## 8. Nota para el front (no es parte de este documento de backend, pero bloquea probar todo el flujo)

`frontend/src/views/invoices/InvoiceFormView.vue` tiene hardcodeados:
```ts
const establishmentId = '00000000-0000-4000-a000-000000000001';
const emissionPointId = '00000000-0000-4000-a000-000000000002';
```
Con las Fases 1–3 de este documento, `issue-invoice.ts` va a validar estos IDs **de verdad** contra organization-service. Si esos UUIDs fijos no existen como establecimiento/punto de emisión reales para la organización actual en tu base de `organization_db`, vas a seguir viendo `EstablishmentNotFoundError` aunque el backend ya esté bien — no por un bug nuevo, sino porque el placeholder del front no apunta a datos reales. Verificar con `GET /establishments` (con tu JWT real, vía el gateway) qué IDs existen de verdad para tu organización antes de probar el flujo de emisión end-to-end. Si no hay ninguno creado todavía, hay que crear un establecimiento y un punto de emisión primero (`POST /establishments`, `POST /establishments/:id/billing-points`, ambos ya existen en organization-service).

---

## Checklist de aceptación final

1. `POST /invoices` con un cliente válido → la factura creada ya trae `customerSnapshot` no nulo.
2. `POST /invoices/:id/lines` con un producto con IVA → la línea trae `taxes` con `amountCents` correcto (ya validado en la conversación previa), y ahora además `GET /invoices/:id` trae `taxTotals` no vacío.
3. `POST /invoices/:id/issue` con establecimiento/punto de emisión reales y activos → la factura queda `status: 'issued'`, con `number` (folio secuencial), `issuerSnapshot` no nulo, `issueDate` seteado.
4. Emitir dos facturas seguidas en el mismo punto de emisión → números de secuencia consecutivos, no se duplica el `Sequence`.
5. Producto inactivo → `add-line` falla con `ProductDisabledError`, no con un 500 ni silenciosamente.
6. Cliente inactivo → `create-invoice`/`update-invoice` fallan con `CustomerDisabledError`.
7. `npm run typecheck` y `npm test` pasan.
8. Nada de lo anterior generó, firmó, ni intentó enviar un XML al SRI.
