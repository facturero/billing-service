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
 * factura (nombre, SKU) y sus impuestos asignados. Best-effort: si el
 * servicio no responde, `findById` devuelve `null` y el caller decide el
 * fallback (no debe romper el flujo de agregar una línea por un problema de
 * red puntual).
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
