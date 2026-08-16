// ── DTOs de entrada ─────────────────────────────────────────────────────────

export interface CreateInvoiceInput {
  customerId: string;
  documentTypeId: string;
  currencyCode: string;
}

export interface UpdateInvoiceInput {
  customerId?: string;
  documentTypeId?: string;
  currencyCode?: string;
}

export interface AddLineInput {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: string;
  discountCents?: number;
}

export interface IssueInvoiceInput {
  establishmentId: string;
  emissionPointId: string;
}

export interface VoidInvoiceInput {
  reason: string;
}

export interface ListInvoicesParams {
  status?: string;
  customerId?: string;
  from?: string;
  to?: string;
}

// ── DTOs de salida ─────────────────────────────────────────────────────────

export interface LineTaxDTO {
  id: string;
  invoiceLineId: string;
  taxRateId: string;
  kind: string;
  rateSnapshot: string;
  baseCents: number;
  amountCents: number;
}

export interface InvoiceLineDTO {
  id: string;
  productId: string;
  productSnapshot: { id: string; name: string; sku: string | null; unit: string | null } | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  subtotalCents: number;
  taxes: LineTaxDTO[];
}

export interface InvoiceTaxTotalDTO {
  id: string;
  kind: string;
  rateSnapshot: string;
  baseCents: number;
  amountCents: number;
}

export interface InvoiceDetailDTO {
  id: string;
  organizationId: string;
  countryCode: string;
  documentTypeId: string;
  number: string | null;
  establishmentId: string | null;
  emissionPointId: string | null;
  customerId: string;
  customerSnapshot: object | null;
  issuerSnapshot: object | null;
  issueDate: string | null;
  currencyCode: string;
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  subtotal: string;
  taxTotal: string;
  total: string;
  status: string;
  voidedAt: string | null;
  voidedReason: string | null;
  lines: InvoiceLineDTO[];
  taxTotals: InvoiceTaxTotalDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceSummaryDTO {
  id: string;
  number: string | null;
  customerName: string;
  customerIdentification: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  currencyCode: string;
  status: string;
  issueDate: string | null;
  createdAt: string;
}
