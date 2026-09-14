import type { DocumentTypeInfo, DocumentTypeCatalogPort } from '../../application/ports.js';

/**
 * tax-service expone GET /countries/:code/document-types. Se cachea un rato por
 * país para no repetir la llamada en cada emisión de factura/nota de crédito
 * (mismo patrón que HttpTaxRateCatalog).
 */
export class HttpDocumentTypeCatalog implements DocumentTypeCatalogPort {
  private cache = new Map<string, { types: DocumentTypeInfo[]; expiresAt: number }>();
  private readonly ttlMs = 60_000;

  constructor(private readonly baseUrl: string | undefined) {}

  async listByCountry(countryCode: string): Promise<DocumentTypeInfo[]> {
    if (!this.baseUrl) {
      console.warn('[billing][document-type-catalog] TAX_SERVICE_URL no configurada (baseUrl vacío), devolviendo []');
      return [];
    }

    const cached = this.cache.get(countryCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.types;
    }

    const url = `${this.baseUrl}/countries/${countryCode}/document-types`;
    try {
      const res = await fetch(url, {
        headers: { 'X-User-Id': 'billing-service' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '<no se pudo leer el body>');
        console.warn(`[billing][document-type-catalog] tax-service respondió ${res.status} al listar tipos documentales de ${countryCode}. Body: ${body}`);
        return cached?.types ?? [];
      }
      const data = await res.json() as DocumentTypeInfo[];
      const types = Array.isArray(data)
        ? data.map((t) => ({ id: t.id, countryCode: t.countryCode, code: t.code, name: t.name }))
        : [];
      this.cache.set(countryCode, { types, expiresAt: Date.now() + this.ttlMs });
      return types;
    } catch (err) {
      console.warn('[billing][document-type-catalog] No se pudo contactar a tax-service:', err);
      return cached?.types ?? [];
    }
  }
}