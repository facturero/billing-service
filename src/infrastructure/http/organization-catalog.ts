import type { OrganizationCatalogPort, IssuerInfo, EstablishmentInfo, EmissionPointInfo } from '../../application/ports.js';

/**
 * billing-service llama a organization-service directo (server-to-server),
 * así que tiene que poner ella misma las cabeceras que organization-service
 * espera del gateway (ver organization-service/src/interface/http/middlewares.ts).
 */
export class HttpOrganizationCatalog implements OrganizationCatalogPort {
  constructor(private readonly baseUrl: string) {}

  async getOrganization(organizationId: string): Promise<IssuerInfo | null> {
    console.log(`[billing][org-catalog] getOrganization(organizationId=${organizationId}) baseUrl=${this.baseUrl}`);

    try {
      const url = `${this.baseUrl}/organizations/me`;
      console.log(`[billing][org-catalog] GET ${url}`);
      const res = await fetch(url, {
        headers: {
          'X-Organization-Id': organizationId,
          'X-Permissions': 'organization:read',
        },
      });
      console.log(`[billing][org-catalog] respuesta status=${res.status} ok=${res.ok}`);

      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => '<no se pudo leer el body>');
        console.warn(`[billing][org-catalog] organization-service respondió ${res.status}. Body: ${body}`);
        return null;
      }

      const data = await res.json() as {
        legalName: string | null;
        tradeName: string | null;
        taxId: string | null;
      };
      console.log(`[billing][org-catalog] data cruda:`, JSON.stringify(data));

      if (!data.legalName || !data.taxId) {
        console.warn('[billing][org-catalog] Organización sin perfil fiscal completo (legalName o taxId nulo)');
        return null;
      }

      const result: IssuerInfo = {
        legalName: data.legalName,
        tradeName: data.tradeName ?? null,
        taxId: data.taxId,
      };
      console.log(`[billing][org-catalog] resultado mapeado:`, JSON.stringify(result));
      return result;
    } catch (err) {
      console.warn('[billing][org-catalog] No se pudo contactar a organization-service:', err);
      return null;
    }
  }

  async getEstablishment(organizationId: string, establishmentId: string): Promise<EstablishmentInfo | null> {
    console.log(`[billing][org-catalog] getEstablishment(organizationId=${organizationId}, establishmentId=${establishmentId})`);

    try {
      const url = `${this.baseUrl}/establishments`;
      console.log(`[billing][org-catalog] GET ${url}`);
      const res = await fetch(url, {
        headers: {
          'X-Organization-Id': organizationId,
          'X-Permissions': 'establishment:read',
        },
      });
      console.log(`[billing][org-catalog] respuesta status=${res.status} ok=${res.ok}`);

      if (!res.ok) {
        const body = await res.text().catch(() => '<no se pudo leer el body>');
        console.warn(`[billing][org-catalog] organization-service respondió ${res.status} al listar establecimientos. Body: ${body}`);
        return null;
      }

      const data = await res.json() as Array<{
        id: string;
        code: string;
        name: string;
        address: string | null;
        status: string;
      }>;
      console.log(`[billing][org-catalog] data cruda (${data.length} establecimientos):`, JSON.stringify(data));

      const match = data.find((e) => e.id === establishmentId) ?? null;
      if (!match) {
        console.warn(`[billing][org-catalog] Establecimiento ${establishmentId} no encontrado en la lista`);
        return null;
      }

      const result: EstablishmentInfo = {
        id: match.id,
        code: match.code,
        name: match.name,
        address: match.address ?? null,
        status: match.status,
      };
      console.log(`[billing][org-catalog] resultado mapeado:`, JSON.stringify(result));
      return result;
    } catch (err) {
      console.warn('[billing][org-catalog] No se pudo contactar a organization-service:', err);
      return null;
    }
  }

  async getEmissionPoint(organizationId: string, establishmentId: string, emissionPointId: string): Promise<EmissionPointInfo | null> {
    console.log(`[billing][org-catalog] getEmissionPoint(organizationId=${organizationId}, establishmentId=${establishmentId}, emissionPointId=${emissionPointId})`);

    try {
      const url = `${this.baseUrl}/establishments/${establishmentId}/billing-points`;
      console.log(`[billing][org-catalog] GET ${url}`);
      const res = await fetch(url, {
        headers: {
          'X-Organization-Id': organizationId,
          'X-Permissions': 'establishment:read',
        },
      });
      console.log(`[billing][org-catalog] respuesta status=${res.status} ok=${res.ok}`);

      if (!res.ok) {
        const body = await res.text().catch(() => '<no se pudo leer el body>');
        console.warn(`[billing][org-catalog] organization-service respondió ${res.status} al listar puntos de emisión. Body: ${body}`);
        return null;
      }

      const data = await res.json() as Array<{
        id: string;
        code: string;
        name: string | null;
        status: string;
      }>;
      console.log(`[billing][org-catalog] data cruda (${data.length} puntos de emisión):`, JSON.stringify(data));

      const match = data.find((ep) => ep.id === emissionPointId) ?? null;
      if (!match) {
        console.warn(`[billing][org-catalog] Punto de emisión ${emissionPointId} no encontrado en la lista`);
        return null;
      }

      const result: EmissionPointInfo = {
        id: match.id,
        code: match.code,
        name: match.name ?? null,
        status: match.status,
      };
      console.log(`[billing][org-catalog] resultado mapeado:`, JSON.stringify(result));
      return result;
    } catch (err) {
      console.warn('[billing][org-catalog] No se pudo contactar a organization-service:', err);
      return null;
    }
  }
}
