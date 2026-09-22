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

// ── Document Type Catalog ─────────────────────────────────────────────────

export interface DocumentTypeInfo {
  id: string;
  countryCode: string;
  /** Código SRI del tipo de comprobante: '01' factura, '04' nota de crédito... */
  code: string;
  name: string;
}

/**
 * Consulta tax-service para resolver el código SRI del tipo documental de una
 * factura. Es lo que le dice a fiscal-ecuador qué XML armar al recibir el
 * evento billing.invoice.issued (`documentTypeCode` en el payload; 01 por
 * defecto). La nota de crédito (#20) se emite con un tipo 04, por eso billing
 * necesita conocer el código.
 */
export interface DocumentTypeCatalogPort {
  listByCountry(countryCode: string): Promise<DocumentTypeInfo[]>;
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
  /** RUC, CEDULA, PASAPORTE... Ver CustomerSnapshot.identificationTypeCode. */
  identificationTypeCode: string | null;
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
  /**
   * El cliente de sistema CONSUMIDOR FINAL de la organización, que customer-service
   * crea solo al darla de alta. Es a quien se factura una venta de mostrador: en
   * caja lo normal es que el comprador no dé sus datos. `null` si no existe.
   */
  findFinalConsumer(organizationId: string): Promise<CustomerInfo | null>;
}

// ── Document Storage (server-to-server upload) ──────────────────────────

export interface DocumentStoragePort {
  /** `organizationId`: document-service solo sirve el archivo a esa organización. */
  upload(params: { organizationId: string; resourceId: string; category: string; originalName: string; mimeType: string; buffer: Buffer }): Promise<void>;
}
