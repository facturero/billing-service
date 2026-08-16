import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueInvoiceUseCase } from '../application/use-cases/issue-invoice.js';
import { EstablishmentNotFoundError, EmissionPointNotFoundError, EmissionPointInactiveError, BadRequestError } from '../domain/errors.js';
import { Invoice } from '../domain/entities.js';
import type { UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, IssuerInfo, EstablishmentInfo, EmissionPointInfo, CustomerInfo } from '../application/ports.js';
import type { AllRepositories } from '../domain/repositories.js';

const orgInfo: IssuerInfo = { legalName: 'Mi Empresa', tradeName: 'ME', taxId: '1234567890' };
const establishmentInfo: EstablishmentInfo = { id: 'est-1', code: '001', name: 'Matriz', address: 'Dir', status: 'active' };
const emissionPointInfo: EmissionPointInfo = { id: 'ep-1', code: '001', name: 'Punto 1', status: 'active' };
const customerInfo: CustomerInfo = { id: 'cust-1', identificationTypeId: 't1', identification: '111', businessName: 'Cliente', tradeName: null, email: null, phone: null, type: 'person', status: 'active' };

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

function makeDraftInvoice(overrides?: Partial<{ customerId: string; customerSnapshot: any }>): Invoice {
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
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function mockUow(repos: AllRepositories): UnitOfWork {
  return { execute: vi.fn().mockImplementation(async (fn: (repos: AllRepositories) => Promise<any>) => fn(repos)) };
}

function mockRepos(invoice: Invoice): AllRepositories {
  return {
    business: {
      invoices: { save: vi.fn(), findById: vi.fn(), findByIdAndOrganization: vi.fn().mockResolvedValue(invoice), findByOrganization: vi.fn(), delete: vi.fn() },
      invoiceLines: { findByInvoice: vi.fn().mockResolvedValue([]), findById: vi.fn(), save: vi.fn(), delete: vi.fn() },
      lineTaxes: { findByInvoiceLine: vi.fn().mockResolvedValue([]), findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoiceLine: vi.fn(), deleteByInvoice: vi.fn() },
      invoiceTaxTotals: { findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoice: vi.fn() },
      sequences: { findByOrganizationAndPoint: vi.fn().mockResolvedValue(null), findById: vi.fn(), save: vi.fn() },
      outbox: { add: vi.fn() },
    },
  };
}

describe('IssueInvoiceUseCase', () => {
  it('issues invoice with issuerSnapshot, number, and sequence', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const orgCatalog = mockOrgCatalog();
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog);

    const result = await uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1' });

    expect(result.status).toBe('issued');
    expect(result.number).toBe('001-001-000000001');
    expect(result.issuerSnapshot).not.toBeNull();
    expect((result.issuerSnapshot as any).legalName).toBe('Mi Empresa');
    expect(result.issueDate).not.toBeNull();
    expect(repos.business.sequences.save).toHaveBeenCalledOnce();
  });

  it('auto-provisions a new Sequence when none exists', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    repos.business.sequences.findByOrganizationAndPoint = vi.fn().mockResolvedValue(null);
    const orgCatalog = mockOrgCatalog();
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog);

    const result = await uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1' });

    expect(result.number).toBe('001-001-000000001');
    expect(repos.business.sequences.save).toHaveBeenCalledOnce();
  });

  it('throws EstablishmentNotFoundError when establishment does not exist', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const orgCatalog = mockOrgCatalog(null, null, null);
    const customerCatalog = mockCustomerCatalog();
    const uow = mockUow(repos);
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog);

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
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog);

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
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog);

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
    const uc = new IssueInvoiceUseCase(uow, orgCatalog, customerCatalog);

    const result = await uc.execute('org-1', 'inv-1', { establishmentId: 'est-1', emissionPointId: 'ep-1' });

    expect(result.customerSnapshot).not.toBeNull();
    expect((result.customerSnapshot as any).businessName).toBe('Cliente');
  });
});
