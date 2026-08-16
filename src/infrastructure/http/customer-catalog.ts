import type { CustomerCatalogPort, CustomerInfo } from '../../application/ports.js';

/**
 * billing-service llama a customer-service directo (server-to-server),
 * así que tiene que poner ella misma las cabeceras que customer-service
 * espera del gateway (ver customer-service/src/interface/http/middlewares.ts).
 */
export class HttpCustomerCatalog implements CustomerCatalogPort {
  constructor(private readonly baseUrl: string) {}

  async findById(organizationId: string, customerId: string): Promise<CustomerInfo | null> {
    console.log(`[billing][customer-catalog] findById(organizationId=${organizationId}, customerId=${customerId}) baseUrl=${this.baseUrl}`);

    try {
      const url = `${this.baseUrl}/customers/${customerId}`;
      console.log(`[billing][customer-catalog] GET ${url}`);
      const res = await fetch(url, {
        headers: {
          'X-Organization-Id': organizationId,
          'X-Permissions': 'customer:read',
        },
      });
      console.log(`[billing][customer-catalog] respuesta status=${res.status} ok=${res.ok}`);

      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => '<no se pudo leer el body>');
        console.warn(`[billing][customer-catalog] customer-service respondió ${res.status} al consultar el cliente ${customerId}. Body: ${body}`);
        return null;
      }

      const data = await res.json() as {
        id: string;
        identificationTypeId: string | null;
        identification: string | null;
        businessName: string;
        tradeName: string | null;
        email: string | null;
        phone: string | null;
        type: string;
        status: string;
      };
      console.log(`[billing][customer-catalog] data cruda:`, JSON.stringify(data));

      const result: CustomerInfo = {
        id: data.id,
        identificationTypeId: data.identificationTypeId ?? '',
        identification: data.identification ?? '',
        businessName: data.businessName,
        tradeName: data.tradeName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        type: data.type === 'company' ? 'company' : 'person',
        status: data.status,
      };
      console.log(`[billing][customer-catalog] resultado mapeado:`, JSON.stringify(result));
      return result;
    } catch (err) {
      console.warn('[billing][customer-catalog] No se pudo contactar a customer-service:', err);
      return null;
    }
  }
}
