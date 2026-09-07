import type { ProductCatalogInfo, ProductCatalogPort } from '../../application/ports.js';
import { ProductCatalogError } from '../../domain/errors.js';

/**
 * billing-service llama a product-service directo (server-to-server, sin pasar
 * por el gateway), así que tiene que poner ella misma las cabeceras que
 * product-service espera del gateway (ver product-service/src/interface/http/middlewares.ts).
 */
export class HttpProductCatalog implements ProductCatalogPort {
  constructor(private readonly baseUrl: string | undefined) {}

  async findById(organizationId: string, productId: string): Promise<ProductCatalogInfo | null> {
    console.log(`[billing][product-catalog] findById(organizationId=${organizationId}, productId=${productId}) baseUrl=${this.baseUrl}`);

    if (!this.baseUrl) {
      // Sin URL de catálogo no hay cómo saber si el producto existe. Fallar
      // explícito en vez de dejar la línea sin impuestos (TEST-PLAN.md #2).
      throw new ProductCatalogError();
    }

    try {
      const url = `${this.baseUrl}/products/${productId}`;
      console.log(`[billing][product-catalog] GET ${url}`);
      const res = await fetch(url, {
        headers: {
          'X-Organization-Id': organizationId,
          'X-Permissions': 'product:read',
        },
      });
      console.log(`[billing][product-catalog] respuesta status=${res.status} ok=${res.ok}`);

      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => '<no se pudo leer el body>');
        console.warn(`[billing][product-catalog] product-service respondió ${res.status} al consultar el producto ${productId}. Body: ${body}`);
        throw new ProductCatalogError();
      }

      const data = await res.json() as {
        id: string;
        name: string;
        sku: string | null;
        status: string;
        priceIncludesTax?: boolean;
        taxes?: { id: string; taxRateId: string; kind: string }[];
      };
      console.log(`[billing][product-catalog] data cruda de product-service:`, JSON.stringify(data));

      const result: ProductCatalogInfo = {
        id: data.id,
        name: data.name,
        sku: data.sku ?? null,
        unit: null,
        status: data.status,
        priceIncludesTax: data.priceIncludesTax ?? false,
        taxes: (data.taxes ?? []).map((t) => ({ taxRateId: t.taxRateId, kind: t.kind })),
      };
      console.log(`[billing][product-catalog] resultado mapeado:`, JSON.stringify(result));
      return result;
    } catch (err) {
      // Incluye red caída y JSON inválido. Distinguir del 404 que NO entra aquí.
      console.warn('[billing][product-catalog] No se pudo contactar a product-service:', err);
      throw new ProductCatalogError();
    }
  }
}
