import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueInvoiceUseCase } from '../application/use-cases/issue-invoice.js';
import { EstablishmentNotFoundError, EmissionPointNotFoundError, EmissionPointInactiveError, BadRequestError } from '../domain/errors.js';
import { Invoice, Sequence } from '../domain/entities.js';
import type { UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, DocumentTypeCatalogPort, IssuerInfo, EstablishmentInfo, EmissionPointInfo, CustomerInfo, DocumentTypeInfo } from '../application/ports.js';
import type { AllRepositories } from '../domain/repositories.js';

const orgInfo: IssuerInfo = { legalName: 'Mi Empresa', tradeName: 'ME', taxId: '1234567890' };
const establishmentInfo: EstablishmentInfo = { id: 'est-1', code: '001', name: 'Matriz', address: 'Dir', status: 'active' };
const emissionPointInfo: EmissionPointInfo = { id: 'ep-1', code: '001', name: 'Punto 1', status: 'active' };
const customerInfo: CustomerInfo = { id: 'cust-1', identificationTypeId: 't1', identificationTypeCode: 'RUC', identification: '111', businessName: 'Cliente', tradeName: null, email: null, phone: null, type: 'person', status: 'active' };

function mockOrgCatalog(org: IssuerInfo | null = orgInfo, est: EstablishmentInfo | null = establishmentInfo, ep: EmissionPointInfo | null = emissionPointInfo): OrganizationCatalogPort {
  return {
    getOrganization: vi.fn().mockResolvedValue(org),
    getEstablishment: vi.fn().mockResolvedValue(est),
    getEmissionPoint: vi.fn().mockResolvedValue(ep),
  };
}

function mockCustomerCatalog(customer: CustomerInfo | null = customerInfo): CustomerCatalogPort {
  return { findById: vi.fn().mockResolvedValue(customer) };
}

const documentTypes: DocumentTypeInfo[] = [
  { id: 'doc-1', countryCode: 'EC', code: '01', name: 'Factura' },
  { id: 'doc-4', countryCode: 'EC', code: '04', name: 'Nota de Crédito' },
];

function mockDocumentTypeCatalog(types: DocumentTypeInfo[] = documentTypes): DocumentTypeCatalogPort {
  return { listByCountry: vi.fn().mockResolvedValue(types) };
}

function makeDraftInvoice(overrides?: Partial<{ customerId: string; customerSnapshot: any; relatedInvoiceId: string | null; creditNoteReason: string | null }>): Invoice {
  return Invoice.fromPersistence({
    id: 'inv-1',
    organizationId: 'org-1',
    countryCode: 'EC',
    documentTypeId: 'doc-1',
    number: null,
    establishmentId: null,
    emissionPointId: null,
    customerId: overrides?.customerId ?? 'cust-1',
    customerSnapshot: overrides?.customerSnapshot ?? { id: 'cust-1', businessName: 'Cliente', identification: '111', identificationTypeId: 't1', email: null, phone: null, type: 'person' },
    issuerSnapshot: null,
    issueDate: null,
    currencyCode: 'USD',
    subtotalCents: 0,
    taxTotalCents: 0,
    totalCents: 0,
    status: 'draft',
    voidedAt: null,
    voidedReason: null,
    relatedInvoiceId: overrides?.relatedInvoiceId ?? null,
    creditNoteReason: overrides?.creditNoteReason ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function mockUow(repos: AllRepositories): UnitOfWork {
  return { execute: vi.fn().mockImplementation(async (fn: (repos: AllRepositories) => Promise<any>) => fn(repos)) };
}

function mockRepos(invoice: Invoice, existingSequence: Sequence | null = makeSequence()): AllRepositories {
  return {
    business: {
      invoices: { save: vi.fn(), findById: vi.fn(), findByIdAndOrganization: vi.fn().mockResolvedValue(invoice), findByOrganization: vi.fn(), delete: vi.fn() },
      invoiceLines: { findByInvoice: vi.fn().mockResolvedValue([]), findById: vi.fn(), save: vi.fn(), delete: vi.fn() },
      lineTaxes: { findByInvoiceLine: vi.fn().mockResolvedValue([]), findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoiceLine: vi.fn(), deleteByInvoice: vi.fn() },
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

function makeSequence(overrides?: Partial<{ id: string; currentValue: number }>): Sequence {
  return Sequence.fromPersistence({
    id: overrides?.id ?? 'seq-1',
    organizationId: 'org-1',
    countryCode: 'EC',
    establishmentId: 'est-1',
    emissionPointId: 'ep-1',
    documentTypeId: 'doc-1',
    currentValue: overrides?.currentValue ?? 0,
  });
}

describe('IssueInvoiceUseCase', () => {
  it('issues invoice with issuerSnapshot, number, and sequence (serie existente)', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice, makeSequence({ currentValue: 0 }));
    const orgCatalog = mockOrgCatalog();
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog, mockDocumentTypeCatalog());

    const result = await uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1' });

    expect(result.status).toBe('issued');
    expect(result.number).toBe('001-001-000000001');
    expect(result.issuerSnapshot).not.toBeNull();
    expect((result.issuerSnapshot as any).legalName).toBe('Mi Empresa');
    expect(result.issueDate).not.toBeNull();
    expect(repos.business.sequences.findByOrganizationAndPoint).toHaveBeenCalledTimes(1);
    expect(repos.business.sequences.createIfAbsent).not.toHaveBeenCalled();
    expect(repos.business.sequences.save).toHaveBeenCalledOnce();

    const issuedEvent = (repos.business.outbox.add as any).mock.calls[0][0];
    expect(issuedEvent.type).toBe('billing.invoice.issued');
    expect(issuedEvent.payload.documentTypeCode).toBe('01');
    expect(issuedEvent.payload.relatedInvoiceId).toBeUndefined();
  });

  it('auto-provisions a new Sequence when none exists', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice, null);
    // La primera lectura (FOR UPDATE) no encuentra serie; tras provisionar
    // (INSERT ... IGNORE) la relectura encuentra la fila ganadora con cv=0.
    repos.business.sequences.findByOrganizationAndPoint = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeSequence({ id: 'seq-p', currentValue: 0 }));
    const orgCatalog = mockOrgCatalog();
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog, mockDocumentTypeCatalog());

    const result = await uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1' });

    expect(result.number).toBe('001-001-000000001');
    expect(repos.business.sequences.findByOrganizationAndPoint).toBeCalledTimes(2);
    expect(repos.business.sequences.createIfAbsent).toHaveBeenCalledOnce();
    expect(repos.business.sequences.save).toHaveBeenCalledOnce();
  });

  it('throws EstablishmentNotFoundError when establishment does not exist', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const orgCatalog = mockOrgCatalog(null, null, null);
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog, mockDocumentTypeCatalog());

    await expect(
      uc.execute('org-1', 'inv-1', { establishmentId: 'bad', emissionPointId: 'ep-1' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('throws EmissionPointNotFoundError when emission point does not exist', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const orgCatalog = mockOrgCatalog(orgInfo, establishmentInfo, null);
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog, mockDocumentTypeCatalog());

    await expect(
      uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'bad' }),
    ).rejects.toThrow(EmissionPointNotFoundError);
  });

  it('throws EmissionPointInactiveError when emission point is inactive', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const orgCatalog = mockOrgCatalog(orgInfo, establishmentInfo, { ...emissionPointInfo, status: 'inactive' });
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog, mockDocumentTypeCatalog());

    await expect(
      uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1' }),
    ).rejects.toThrow(EmissionPointInactiveError);
  });

  it('sets customerSnapshot defensively if missing', async () => {
    const invoice = makeDraftInvoice({ customerSnapshot: null });
    const repos = mockRepos(invoice);
    const orgCatalog = mockOrgCatalog();
    const customerCatalog = mockCustomerCatalog(customerInfo);
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog, mockDocumentTypeCatalog());

    const result = await uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1' });

    expect(result.customerSnapshot).not.toBeNull();
    expect((result.customerSnapshot as any).businessName).toBe('Cliente');
  });
});
