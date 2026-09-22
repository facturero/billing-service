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
  /** Usuario que emite (X-User-Id). Viaja en el evento para que el gateway sepa
   *  a qué sala `user:<uid>` mandar la campana y notification-service pueda
   *  respetar la preferencia smtp del usuario. */
  userId?: string;
}

export interface PosSaleLineInput {
  productId: string;
  description?: string;
  quantity: number;
  unitPrice: string;
  discountCents?: number;
}

export interface IngestPosSaleInput {
  /** Terminal que vendió, y la venta en SU base local: juntos son la clave de idempotencia. */
  terminalId: string;
  posSaleId: string;
  establishmentId: string;
  emissionPointId: string;
  /** Cliente del CRM si la caja lo pidió; sin él se factura a CONSUMIDOR FINAL. */
  customerId?: string | null;
  currencyCode?: string;
  /** Total que calculó el terminal, en centavos, solo para contrastarlo con el recalculado. */
  posTotalCents?: number;
  userId?: string;
  lines: PosSaleLineInput[];
}

export interface VoidInvoiceInput {
  reason: string;
  /** Usuario que anula (X-User-Id). Ver IssueInvoiceInput.userId. */
  userId?: string;
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
  /** Origen de la factura cuando vino de una caja: terminal, venta local y desvío de totales. */
  posTerminalId: string | null;
  posSaleId: string | null;
  posTotalsDiffCents: number | null;
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
