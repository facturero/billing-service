import { renderInvoicePdf } from './render-invoice-pdf.js';
import { renderInvoiceXml } from './render-invoice-xml.js';

export interface InvoiceIssuedEvent {
  invoiceId: string;
  number: string;
  sequentialNumber: string;
  organizationId: string;
  countryCode: string;
  customerSnapshot: {
    businessName: string;
    identification: string;
    email?: string | null;
    phone?: string | null;
  } | null;
  issuerSnapshot: {
    legalName: string;
    tradeName?: string | null;
    taxId: string;
    establishmentCode?: string;
    emissionPointCode?: string;
    address?: string | null;
  } | null;
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  currencyCode: string;
  lines: Array<{
    productId: string;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents: number;
    subtotalCents: number;
    taxes: Array<{
      taxRateId: string;
      kind: string;
      rateSnapshot: string;
      baseCents: number;
      amountCents: number;
    }>;
  }>;
}

export interface DocumentGenerator {
  key: string;
  mimeType: string;
  fileExtension: string;
  render(payload: InvoiceIssuedEvent): Promise<Buffer> | Buffer;
}

const REGISTRY: Record<string, DocumentGenerator[]> = {
  EC: [
    { key: 'ec-generic-pdf', mimeType: 'application/pdf', fileExtension: 'pdf', render: renderInvoicePdf },
    { key: 'ec-generic-xml', mimeType: 'application/xml', fileExtension: 'xml', render: (p) => Buffer.from(renderInvoiceXml(p), 'utf-8') },
  ],
};

export function resolveDocumentGenerators(countryCode: string): DocumentGenerator[] {
  return REGISTRY[countryCode] ?? [];
}
