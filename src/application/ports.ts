import type { AllRepositories } from '../domain/repositories.js';

export interface UnitOfWork {
  execute<T>(fn: (repos: AllRepositories) => Promise<T>): Promise<T>;
}

export interface ProductCatalogInfo {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  status: string;
  priceIncludesTax: boolean;
  taxes: { taxRateId: string; kind: string }[];
}

/**
 * Consulta product-service para armar el `productSnapshot` de una línea de
 * factura (nombre, SKU) y sus impuestos asignados.
 *
 * Contrato:
 * - `null` ⇔ el producto NO existe (404). El caller responde 400.
 * - Lanza `ProductCatalogError` cuando el catálogo NO pudó responder
 *   (5xx, red) o la respuesta no es válida: en esos casos no podemos saber si
 *   el producto existe ni con qué impuestos gravar la línea. Crear la línea
 *   sin impuestos (o con snapshot vacío) silenciosamente corrompería la
 *   facturación, así que el caller responde 503 (TEST-PLAN.md #2).
 */
export interface ProductCatalogPort {
  findById(organizationId: string, productId: string): Promise<ProductCatalogInfo | null>;
}

export interface TaxRateInfo {
  id: string;
  percentage: string;
  kind: string;
}

/** Consulta tax-service para resolver el porcentaje real de una tasa de impuesto. */
export interface TaxRatePort {
  findRate(countryCode: string, taxRateId: string): Promise<TaxRateInfo | null>;
}

// ── Organization Catalog ──────────────────────────────────────────────────

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

// ── Customer Catalog ──────────────────────────────────────────────────────

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

// ── Document Storage (server-to-server upload) ──────────────────────────

export interface DocumentStoragePort {
  upload(params: { resourceId: string; category: string; originalName: string; mimeType: string; buffer: Buffer }): Promise<void>;
}
