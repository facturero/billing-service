import type { TaxRateInfo, TaxRatePort } from '../../application/ports.js';

/**
 * tax-service no expone un endpoint GET /tax-rates/:id, solo el listado por
 * país (GET /countries/:code/tax-rates). Se trae la lista completa del país
 * y se busca el id dentro; se cachea un rato por país para no repetir la
 * llamada en cada línea de una misma factura.
 */
export class HttpTaxRateCatalog implements TaxRatePort {
  private cache = new Map<string, { rates: TaxRateInfo[]; expiresAt: number }>();
  private readonly ttlMs = 60_000;

  constructor(private readonly baseUrl: string | undefined) {}

  async findRate(countryCode: string, taxRateId: string): Promise<TaxRateInfo | null> {
    console.log(`[billing][tax-rate-catalog] findRate(countryCode=${countryCode}, taxRateId=${taxRateId}) baseUrl=${this.baseUrl}`);
    const rates = await this.ratesForCountry(countryCode);
    console.log(`[billing][tax-rate-catalog] tasas disponibles para ${countryCode}:`, JSON.stringify(rates));
    const match = rates.find((r) => r.id === taxRateId) ?? null;
    console.log(`[billing][tax-rate-catalog] match para taxRateId=${taxRateId}:`, JSON.stringify(match));
    return match;
  }

  private async ratesForCountry(countryCode: string): Promise<TaxRateInfo[]> {
    if (!this.baseUrl) {
      console.warn('[billing][tax-rate-catalog] TAX_SERVICE_URL no configurada (baseUrl vacío), devolviendo []');
      return [];
    }

    const cached = this.cache.get(countryCode);
    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[billing][tax-rate-catalog] usando cache para ${countryCode} (expira en ${cached.expiresAt - Date.now()}ms)`);
      return cached.rates;
    }

    const url = `${this.baseUrl}/countries/${countryCode}/tax-rates`;
    console.log(`[billing][tax-rate-catalog] GET ${url}`);
    try {
      const res = await fetch(url, {
        headers: { 'X-User-Id': 'billing-service' },
      });
      console.log(`[billing][tax-rate-catalog] respuesta status=${res.status} ok=${res.ok}`);
      if (!res.ok) {
        const body = await res.text().catch(() => '<no se pudo leer el body>');
        console.warn(`[billing][tax-rate-catalog] tax-service respondió ${res.status} al listar tasas de ${countryCode}. Body: ${body}`);
        return cached?.rates ?? [];
      }
      const data = await res.json() as { id: string; percentage: string | number; kind: string }[];
      console.log(`[billing][tax-rate-catalog] data cruda de tax-service:`, JSON.stringify(data));
      const rates = Array.isArray(data)
        ? data.map((r) => ({ id: r.id, percentage: String(r.percentage), kind: r.kind }))
        : [];
      this.cache.set(countryCode, { rates, expiresAt: Date.now() + this.ttlMs });
      return rates;
    } catch (err) {
      console.warn('[billing][tax-rate-catalog] No se pudo contactar a tax-service:', err);
      return cached?.rates ?? [];
    }
  }
}
