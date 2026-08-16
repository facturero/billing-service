import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateInvoiceUseCase } from '../application/use-cases/create-invoice.js';
import { CustomerNotFoundError, CustomerDisabledError } from '../domain/errors.js';
import type { UnitOfWork, CustomerCatalogPort, CustomerInfo } from '../application/ports.js';
import type { AllRepositories } from '../domain/repositories.js';

function mockRepos(): AllRepositories {
  return {
    business: {
      invoices: { save: vi.fn(), findById: vi.fn(), findByIdAndOrganization: vi.fn(), findByOrganization: vi.fn(), delete: vi.fn() },
      invoiceLines: { findByInvoice: vi.fn().mockResolvedValue([]), findById: vi.fn(), save: vi.fn(), delete: vi.fn() },
      lineTaxes: { findByInvoiceLine: vi.fn().mockResolvedValue([]), findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoiceLine: vi.fn(), deleteByInvoice: vi.fn() },
      invoiceTaxTotals: { findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoice: vi.fn() },
      sequences: { findByOrganizationAndPoint: vi.fn(), findById: vi.fn(), save: vi.fn() },
      outbox: { add: vi.fn() },
    },
  };
}

function mockCustomerCatalog(customer: CustomerInfo | null): CustomerCatalogPort {
  return { findById: vi.fn().mockResolvedValue(customer) };
}

function mockUow(repos: AllRepositories): UnitOfWork {
  return { execute: vi.fn().mockImplementation(async (fn: (repos: AllRepositories) => Promise<any>) => fn(repos)) };
}

const validCustomer: CustomerInfo = {
  id: 'cust-1',
  identificationTypeId: 'type-1',
  identification: '1234567890',
  businessName: 'Test Customer',
  tradeName: null,
  email: null,
  phone: null,
  type: 'person',
  status: 'active',
};

describe('CreateInvoiceUseCase', () => {
  it('creates invoice with customerSnapshot set', async () => {
    const repos = mockRepos();
    const customerCatalog = mockCustomerCatalog(validCustomer);
    const uow = mockUow(repos);
    const uc = new CreateInvoiceUseCase(uow, customerCatalog);

    const result = await uc.execute({
      organizationId: 'org-1',
      countryCode: 'EC',
      customerId: 'cust-1',
      documentTypeId: 'doc-1',
      currencyCode: 'USD',
    });

    expect(result.customerSnapshot).not.toBeNull();
    expect((result.customerSnapshot as any).businessName).toBe('Test Customer');
    expect(repos.business.invoices.save).toHaveBeenCalledOnce();
    expect(repos.business.outbox.add).toHaveBeenCalledOnce();
  });

  it('throws CustomerNotFoundError when customer does not exist', async () => {
    const repos = mockRepos();
    const customerCatalog = mockCustomerCatalog(null);
    const uow = mockUow(repos);
    const uc = new CreateInvoiceUseCase(uow, customerCatalog);

    await expect(
      uc.execute({
        organizationId: 'org-1',
        countryCode: 'EC',
        customerId: 'nonexistent',
        documentTypeId: 'doc-1',
        currencyCode: 'USD',
      }),
    ).rejects.toThrow(CustomerNotFoundError);
  });

  it('throws CustomerDisabledError when customer is inactive', async () => {
    const repos = mockRepos();
    const customerCatalog = mockCustomerCatalog({ ...validCustomer, status: 'inactive' });
    const uow = mockUow(repos);
    const uc = new CreateInvoiceUseCase(uow, customerCatalog);

    await expect(
      uc.execute({
        organizationId: 'org-1',
        countryCode: 'EC',
        customerId: 'cust-1',
        documentTypeId: 'doc-1',
        currencyCode: 'USD',
      }),
    ).rejects.toThrow(CustomerDisabledError);
  });
});
