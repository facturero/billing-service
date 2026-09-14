import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueCreditNoteUseCase } from '../application/use-cases/issue-credit-note.js';
import { IssueInvoiceUseCase } from '../application/use-cases/issue-invoice.js';
import { InvoiceNotFoundError, BadRequestError } from '../domain/errors.js';
import { Invoice, InvoiceLine, LineTax, Sequence } from '../domain/entities.js';
import type { UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, DocumentTypeCatalogPort, IssuerInfo, EstablishmentInfo, EmissionPointInfo, CustomerInfo, DocumentTypeInfo } from '../application/ports.js';
import type { AllRepositories } from '../domain/repositories.js';

const orgInfo: IssuerInfo = { legalName: 'Mi Empresa', tradeName: 'ME', taxId: '1234567890' };
const establishmentInfo: EstablishmentInfo = { id: 'est-1', code: '001', name: 'Matriz', address: 'Dir', status: 'active' };
const emissionPointInfo: EmissionPointInfo = { id: 'ep-1', code: '001', name: 'Punto 1', status: 'active' };
const customerInfo: CustomerInfo = { id: 'cust-1', identificationTypeId: 't1', identificationTypeCode: 'RUC', identification: '111', businessName: 'Cliente', tradeName: null, email: null, phone: null, type: 'person', status: 'active' };

const documentTypes: DocumentTypeInfo[] = [
  { id: 'doc-1', countryCode: 'EC', code: '01', name: 'Factura' },
  { id: 'doc-4', countryCode: 'EC', code: '04', name: 'Nota de Crédito' },
];

function mockOrgCatalog(): OrganizationCatalogPort {
  return {
    getOrganization: vi.fn().mockResolvedValue(orgInfo),
    getEstablishment: vi.fn().mockResolvedValue(establishmentInfo),
    getEmissionPoint: vi.fn().mockResolvedValue(emissionPointInfo),
  };
}

function mockCustomerCatalog(): CustomerCatalogPort {
  return { findById: vi.fn().mockResolvedValue(customerInfo) };
}

function mockDocumentTypeCatalog(types: DocumentTypeInfo[] = documentTypes): DocumentTypeCatalogPort {
  return { listByCountry: vi.fn().mockResolvedValue(types) };
}

const customerSnapshot = {
  id: 'cust-1',
  businessName: 'Cliente',
  identification: '111',
  identificationTypeId: 't1',
  identificationTypeCode: 'RUC',
  email: null,
  phone: null,
  type: 'person' as const,
};

const originalLine = InvoiceLine.fromPersistence({
  id: 'line-1',
  invoiceId: 'inv-1',
  productId: 'prod-1',
  productSnapshot: { id: 'prod-1', name: 'Producto', sku: 'SKU-1', unit: 'u' },
  description: 'Producto',
  quantity: 2,
  unitPriceCents: 1000,
  discountCents: 0,
  subtotalCents: 2000,
});

const originalTax = LineTax.fromPersistence({
  id: 'tax-1',
  invoiceLineId: 'line-1',
  taxRateId: 'rate-iva15',
  kind: 'vat',
  rateSnapshot: 'IVA15',
  baseCents: 2000,
  amountCents: 300,
});

function makeOriginalInvoice(overrides?: Partial<{ status: string; establishmentId: string | null; customerSnapshot: any }>): Invoice {
  return Invoice.fromPersistence({
    id: 'inv-1',
    organizationId: 'org-1',
    countryCode: 'EC',
    documentTypeId: 'doc-1',
    number: '001-001-000000001',
    establishmentId: overrides?.establishmentId ?? 'est-1',
    emissionPointId: 'ep-1',
    customerId: 'cust-1',
    customerSnapshot: overrides?.customerSnapshot ?? customerSnapshot,
    issuerSnapshot: { legalName: 'Mi Empresa', tradeName: 'ME', taxId: '1234567890', establishmentCode: '001', emissionPointCode: '001', address: 'Dir' },
    issueDate: new Date('2026-09-01T10:00:00.000Z'),
    currencyCode: 'USD',
    subtotalCents: 2000,
    taxTotalCents: 300,
    totalCents: 2300,
    status: (overrides?.status ?? 'issued') as any,
    voidedAt: null,
    voidedReason: null,
    relatedInvoiceId: null,
    creditNoteReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function makeSequence(): Sequence {
  return Sequence.fromPersistence({
    id: 'seq-4',
    organizationId: 'org-1',
    countryCode: 'EC',
    establishmentId: 'est-1',
    emissionPointId: 'ep-1',
    documentTypeId: 'doc-4',
    currentValue: 0,
  });
}

function mockRepos(original: Invoice, existingSequence: Sequence | null = makeSequence()): AllRepositories {
  return {
    business: {
      invoices: {
        save: vi.fn(),
        findById: vi.fn(),
        findByIdAndOrganization: vi.fn().mockResolvedValue(original),
        findByOrganization: vi.fn(),
        delete: vi.fn(),
      },
      invoiceLines: {
        findByInvoice: vi.fn().mockResolvedValue([originalLine]),
        findById: vi.fn(),
        save: vi.fn(),
        delete: vi.fn(),
      },
      lineTaxes: {
        findByInvoiceLine: vi.fn().mockResolvedValue([originalTax]),
        findByInvoice: vi.fn().mockResolvedValue([originalTax]),
        save: vi.fn(),
        deleteByInvoiceLine: vi.fn(),
        deleteByInvoice: vi.fn(),
      },
      invoiceTaxTotals: { findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoice: vi.fn() },
      sequences: {
        findByOrganizationAndPoint: existingSequence
          ? vi.fn().mockResolvedValue(existingSequence)
          : vi.fn().mockResolvedValue(null),
        findById: vi.fn(),
        createIfAbsent: vi.fn(),
        save: vi.fn(),
      },
      outbox: { add: vi.fn() },
    },
  };
}

function makeUow(repos: AllRepositories): UnitOfWork {
  return { execute: vi.fn().mockImplementation(async (fn: (repos: AllRepositories) => Promise<any>) => fn(repos)) };
}

describe('IssueCreditNoteUseCase', () => {
  it('emits a credit note cloning the original and enriches the event', async () => {
    const original = makeOriginalInvoice();
    const repos = mockRepos(original);
    const uow = makeUow(repos);
    const uc = new IssueCreditNoteUseCase(uow, mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog());

    const result = await uc.execute('org-1', 'inv-1', {
      establishmentId: 'est-1',
      emissionPointId: 'ep-1',
      reason: 'Devolución parcial de mercadería',
    });

    expect(result.status).toBe('issued');
    expect(result.number).toBe('001-001-000000001');
    expect(result.subtotalCents).toBe(2000);
    expect(result.taxTotalCents).toBe(300);
    expect(result.totalCents).toBe(2300);

    // usa la serie del tipo 04, separada de la de facturas
    expect(repos.business.sequences.findByOrganizationAndPoint).toHaveBeenCalledWith('org-1', 'ep-1', 'doc-4');

    const issuedEvent = (repos.business.outbox.add as any).mock.calls[0][0];
    expect(issuedEvent.type).toBe('billing.invoice.issued');
    expect(issuedEvent.payload.documentTypeCode).toBe('04');
    expect(issuedEvent.payload.relatedInvoiceId).toBe('inv-1');
    expect(issuedEvent.payload.relatedIssueDate).toBe('2026-09-01T10:00:00.000Z');
    expect(issuedEvent.payload.creditNoteReason).toBe('Devolución parcial de mercadería');
    expect(issuedEvent.payload.relatedInvoiceId).not.toBeUndefined();
  });

  it('rejects a draft original with BadRequestError', async () => {
    const original = makeOriginalInvoice({ status: 'draft' });
    const repos = mockRepos(original);
    const uow = makeUow(repos);
    const uc = new IssueCreditNoteUseCase(uow, mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog());

    await expect(
      uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1', reason: 'Motivo' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects when the catalog has no 04 document type', async () => {
    const original = makeOriginalInvoice();
    const repos = mockRepos(original);
    const uow = makeUow(repos);
    const uc = new IssueCreditNoteUseCase(uow, mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog([documentTypes[0]]));

    await expect(
      uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1', reason: 'Motivo' }),
    ).rejects.toThrow(BadRequestError);
    expect(repos.business.outbox.add).not.toHaveBeenCalled();
  });

  it('rejects when the original does not exist', async () => {
    const repos = mockRepos(makeOriginalInvoice());
    (repos.business.invoices.findByIdAndOrganization as any).mockResolvedValue(null);
    const uow = makeUow(repos);
    const uc = new IssueCreditNoteUseCase(uow, mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog());

    await expect(
      uc.execute('org-1', 'inv-9', { establishmentId: 'est-1', emissionPointId: 'ep-1', reason: 'Motivo' }),
    ).rejects.toThrow(InvoiceNotFoundError);
  });

  it('allows an original that was voided and requires same establishment', async () => {
    const original = makeOriginalInvoice({ status: 'voided', establishmentId: 'est-1' });
    const repos = mockRepos(original);
    const uow = makeUow(repos);
    const uc = new IssueCreditNoteUseCase(uow, mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog());

    const ok = await uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1', reason: 'Motivo' });
    expect(ok.status).toBe('issued');

    const reposOther = mockRepos(original);
    const ucOther = new IssueCreditNoteUseCase(makeUow(reposOther), mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog());
    await expect(
      ucOther.execute('org-1', 'inv-1', { establishmentId: 'est-9', emissionPointId: 'ep-1', reason: 'Motivo' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('requires a non-empty reason', async () => {
    const original = makeOriginalInvoice();
    const repos = mockRepos(original);
    const uc = new IssueCreditNoteUseCase(makeUow(repos), mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog());

    await expect(
      uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1', reason: ' ' }),
    ).rejects.toThrow(BadRequestError);
    expect(repos.business.outbox.add).not.toHaveBeenCalled();
  });

  it('IssueInvoiceUseCase still works alongside credit notes', async () => {
    const invoice = Invoice.fromPersistence({
      id: 'inv-factura',
      organizationId: 'org-1',
      countryCode: 'EC',
      documentTypeId: 'doc-1',
      number: null,
      establishmentId: null,
      emissionPointId: null,
      customerId: 'cust-1',
      customerSnapshot,
      issuerSnapshot: null,
      issueDate: null,
      currencyCode: 'USD',
      subtotalCents: 2000,
      taxTotalCents: 300,
      totalCents: 2300,
      status: 'draft',
      voidedAt: null,
      voidedReason: null,
      relatedInvoiceId: null,
      creditNoteReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const repos = mockRepos(makeOriginalInvoice());
    repos.business.invoices.findByIdAndOrganization = vi.fn().mockResolvedValue(invoice);
    const uow = makeUow(repos);
    const uc = new IssueInvoiceUseCase(uow, mockOrgCatalog(), mockCustomerCatalog(), mockDocumentTypeCatalog());

    const result = await uc.execute('org-1', 'inv-factura', { establishmentId: 'est-1', emissionPointId: 'ep-1' });
    expect(result.status).toBe('issued');
    const issuedEvent = (repos.business.outbox.add as any).mock.calls[0][0];
    expect(issuedEvent.payload.documentTypeCode).toBe('01');
    expect(issuedEvent.payload.relatedInvoiceId).toBeUndefined();
  });
});