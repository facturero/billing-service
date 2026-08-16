import type { Invoice, InvoiceLine, LineTax, InvoiceTaxTotal, Sequence, InvoiceProps, InvoiceLineProps, LineTaxProps, InvoiceTaxTotalProps, SequenceProps } from './entities.js';

export interface InvoiceRepository {
  findById(id: string): Promise<Invoice | null>;
  findByIdAndOrganization(id: string, organizationId: string): Promise<Invoice | null>;
  findByOrganization(organizationId: string, params?: { status?: string; customerId?: string; from?: string; to?: string }): Promise<Invoice[]>;
  save(invoice: Invoice): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface InvoiceLineRepository {
  findByInvoice(invoiceId: string): Promise<InvoiceLine[]>;
  findById(id: string): Promise<InvoiceLine | null>;
  save(line: InvoiceLine): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface LineTaxRepository {
  findByInvoiceLine(invoiceLineId: string): Promise<LineTax[]>;
  findByInvoice(invoiceId: string): Promise<LineTax[]>;
  save(lineTax: LineTax): Promise<void>;
  deleteByInvoiceLine(invoiceLineId: string): Promise<void>;
  deleteByInvoice(invoiceId: string): Promise<void>;
}

export interface InvoiceTaxTotalRepository {
  findByInvoice(invoiceId: string): Promise<InvoiceTaxTotal[]>;
  save(taxTotal: InvoiceTaxTotal): Promise<void>;
  deleteByInvoice(invoiceId: string): Promise<void>;
}

export interface SequenceRepository {
  findByOrganizationAndPoint(organizationId: string, emissionPointId: string, documentTypeId: string): Promise<Sequence | null>;
  findById(id: string): Promise<Sequence | null>;
  save(sequence: Sequence): Promise<void>;
}

export interface OutboxRepository {
  add(entry: {
    eventId: string;
    organizationId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
    occurredAt: Date;
  }): Promise<void>;
}

export interface BusinessRepositories {
  invoices: InvoiceRepository;
  invoiceLines: InvoiceLineRepository;
  lineTaxes: LineTaxRepository;
  invoiceTaxTotals: InvoiceTaxTotalRepository;
  sequences: SequenceRepository;
  outbox: OutboxRepository;
}

export interface AllRepositories {
  business: BusinessRepositories;
}
