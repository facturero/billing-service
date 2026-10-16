# billing-service — Implementation

## Clean Architecture layers

```
src/
  main.ts                    -- Composition root
  domain/                    -- Entities, errors, value-objects, repository interfaces
  application/               -- Use-cases, DTOs, UnitOfWork port, catalog ports
    use-cases/shared/         -- Shared helpers (recompute-tax-totals)
  infrastructure/            -- Sequelize models, repositories, env config, HTTP clients
    persistence/
      sequelize.ts           -- Sequelize instance
      models.ts              -- ORM model definitions
      repositories.ts        -- Repository implementations + UnitOfWork
    http/
      product-catalog.ts     -- HTTP client → product-service
      tax-rate-catalog.ts    -- HTTP client → tax-service
      organization-catalog.ts -- HTTP client → organization-service
      customer-catalog.ts    -- HTTP client → customer-service
  interface/
    http/
      app.ts                 -- Hono application factory
      routes.ts              -- Route registration
      controllers.ts         -- Request handlers
      middlewares.ts         -- Auth, organization, permission middleware
      validators.ts          -- Zod schemas for request validation
```

## Key decisions

1. **Fase 1: commercial only** — No SRI, no fiscal authorities. Cycle: draft → issued → voided.
2. **Atomic sequences** — `SELECT ... FOR UPDATE` via unique constraint on (org, emission_point, document_type). Auto-provisioned on first issue (no dedicated endpoint).
3. **Snapshots** — Customer, issuer, product, rate data frozen at creation/issue time as JSON.
4. **Dinero.js** — All amounts in cents (BIGINT) with currency_code.
5. **Catalog ports (on-demand)** — Cross-service data (org, customer, product, tax rates) resolved via HTTP calls from billing-service directly to each microservice (server-to-server). No in-memory read-models cache. Each HTTP client follows the best-effort + logging pattern established by `HttpProductCatalog`.
6. **Outbox pattern** — Events written in same transaction as domain changes.
7. **Tax totals grouping** — `invoice_tax_totals` populated by grouping `LineTax[]` by `(kind, rateSnapshot)` after each line add/remove and before issuing.
8. **Multi-tax priceIncludesTax** — When a product has multiple taxes with `priceIncludesTax`, the combined rate is computed once, the base extracted once, and the total tax distributed proportionally among each rate.

## Permissions (from auth-service seed)

- `invoice:create` — create draft invoices
- `invoice:read` — list and view invoices
- `invoice:update` — edit drafts, add/remove lines
- `invoice:issue` — issue (assign sequential)
- `invoice:void` — void issued invoices
- `invoice:authorize` — (Fase 2, fiscal authorization)

## Nota de débito (Fase 1.4 del plan ERP)

`POST /invoices/:id/debit-note` (permiso `invoice:issue`): cobra cargos adicionales sobre una factura **emitida** (no un borrador ni una anulada, y nunca sobre una nota de crédito). Cuerpo: establecimiento y punto de emisión (el establecimiento debe ser el de la factura), de 1 a 20 `motives` (`reason` ≤ 300 caracteres, `amount` con hasta dos decimales, `taxRateId` de una tarifa de IVA) y `paymentMethodCode` opcional. Cada motivo se guarda como una línea de cantidad 1 con su impuesto; la numeración es la serie propia del tipo 05. Emite `billing.invoice.issued` con `documentTypeCode: '05'`, `relatedInvoiceId` y `relatedIssueDate`; fiscal-ecuador la firma con el XML de nota de débito (los motivos van como `motivos`, no como detalle). Reutiliza `issueInvoiceInTransaction`. Requiere el tipo de documento `05` en el catálogo fiscal.
