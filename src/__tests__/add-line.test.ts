import { describe, it, expect, vi } from 'vitest';
import { AddLineUseCase } from '../application/use-cases/add-line.js';
import { InvoiceNotFoundError, BadRequestError, ProductDisabledError } from '../domain/errors.js';
import { Invoice } from '../domain/entities.js';
import type { UnitOfWork, ProductCatalogPort, TaxRatePort, ProductCatalogInfo, TaxRateInfo } from '../application/ports.js';
import type { AllRepositories } from '../domain/repositories.js';

function makeDraftInvoice(): Invoice {
  return Invoice.fromPersistence({
    id: 'inv-1',
    organizationId: 'org-1',
    countryCode: 'EC',
    documentTypeId: 'doc-1',
    number: null,
    establishmentId: null,
    emissionPointId: null,
    customerId: 'cust-1',
    customerSnapshot: { id: 'cust-1', businessName: 'Cliente', identification: '111', identificationTypeId: 't1', email: null, phone: null, type: 'person' },
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

const activeProduct: ProductCatalogInfo = {
  id: 'prod-1',
  name: 'Widget',
  sku: 'W001',
  unit: 'unit',
  status: 'active',
  priceIncludesTax: false,
  taxes: [{ taxRateId: 'tax-iva', kind: 'vat' }],
};

const taxRate15: TaxRateInfo = { id: 'tax-iva', percentage: '15', kind: 'vat' };

function mockProductCatalog(product: ProductCatalogInfo | null = activeProduct): ProductCatalogPort {
  return { findById: vi.fn().mockResolvedValue(product) };
}

function mockTaxRateCatalog(rate: TaxRateInfo | null = taxRate15): TaxRatePort {
  return { findRate: vi.fn().mockResolvedValue(rate) };
}

function mockRepos(invoice: Invoice): AllRepositories & { _savedLines: any[] } {
  const savedLines: any[] = [];
  return {
    _savedLines: savedLines,
    business: {
      invoices: { save: vi.fn(), findById: vi.fn(), findByIdAndOrganization: vi.fn().mockResolvedValue(invoice), findByOrganization: vi.fn(), delete: vi.fn() },
      invoiceLines: {
        findByInvoice: vi.fn().mockImplementation(() => Promise.resolve(savedLines)),
        findById: vi.fn(),
        save: vi.fn().mockImplementation((line: any) => { savedLines.push(line); }),
        delete: vi.fn(),
      },
      lineTaxes: { findByInvoiceLine: vi.fn().mockResolvedValue([]), findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoiceLine: vi.fn(), deleteByInvoice: vi.fn() },
      invoiceTaxTotals: { findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoice: vi.fn() },
      sequences: { findByOrganizationAndPoint: vi.fn(), findById: vi.fn(), save: vi.fn() },
      outbox: { add: vi.fn() },
    },
  };
}

function mockUow(repos: AllRepositories): UnitOfWork {
  return { execute: vi.fn().mockImplementation(async (fn: (repos: AllRepositories) => Promise<any>) => fn(repos)) };
}

describe('AddLineUseCase', () => {
  it('calculates tax correctly with priceIncludesTax=false', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const productCatalog = mockProductCatalog({ ...activeProduct, priceIncludesTax: false });
    const taxRateCatalog = mockTaxRateCatalog();
    const uow = mockUow(repos);
    const uc = new AddLineUseCase(uow, productCatalog, taxRateCatalog);

    const result = await uc.execute('org-1', 'inv-1', {
      productId: 'prod-1',
      description: 'Widget x10',
      quantity: 10,
      unitPrice: '10.00',
    });

    const line = result.lines[0];
    expect(line.subtotalCents).toBe(10000);
    const tax = line.taxes[0];
    expect(tax.baseCents).toBe(10000);
    expect(tax.amountCents).toBe(1500);
  });

  it('calculates tax correctly with priceIncludesTax=true', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const productCatalog = mockProductCatalog({ ...activeProduct, priceIncludesTax: true });
    const taxRateCatalog = mockTaxRateCatalog();
    const uow = mockUow(repos);
    const uc = new AddLineUseCase(uow, productCatalog, taxRateCatalog);

    const result = await uc.execute('org-1', 'inv-1', {
      productId: 'prod-1',
      description: 'Widget x10',
      quantity: 10,
      unitPrice: '11.50',
    });

    const line = result.lines[0];
    expect(line.subtotalCents).toBe(11500);
    const tax = line.taxes[0];
    expect(tax.baseCents).toBe(10000);
    expect(tax.amountCents).toBe(1500);
  });

  it('throws ProductDisabledError when product is inactive', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const productCatalog = mockProductCatalog({ ...activeProduct, status: 'inactive' });
    const taxRateCatalog = mockTaxRateCatalog();
    const uow = mockUow(repos);
    const uc = new AddLineUseCase(uow, productCatalog, taxRateCatalog);

    await expect(
      uc.execute('org-1', 'inv-1', {
        productId: 'prod-1',
        description: 'Widget',
        quantity: 1,
        unitPrice: '10.00',
      }),
    ).rejects.toThrow(ProductDisabledError);
  });

  it('throws when discount exceeds line subtotal', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const productCatalog = mockProductCatalog();
    const taxRateCatalog = mockTaxRateCatalog();
    const uow = mockUow(repos);
    const uc = new AddLineUseCase(uow, productCatalog, taxRateCatalog);

    await expect(
      uc.execute('org-1', 'inv-1', {
        productId: 'prod-1',
        description: 'Widget',
        quantity: 1,
        unitPrice: '10.00',
        discountCents: 2000,
      }),
    ).rejects.toThrow(BadRequestError);
  });

  it('recomputes invoice_tax_totals after adding line', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const productCatalog = mockProductCatalog();
    const taxRateCatalog = mockTaxRateCatalog();
    const uow = mockUow(repos);
    const uc = new AddLineUseCase(uow, productCatalog, taxRateCatalog);

    await uc.execute('org-1', 'inv-1', {
      productId: 'prod-1',
      description: 'Widget x10',
      quantity: 10,
      unitPrice: '10.00',
    });

    expect(repos.business.invoiceTaxTotals.deleteByInvoice).toHaveBeenCalledWith('inv-1');
    expect(repos.business.invoiceTaxTotals.save).toHaveBeenCalledOnce();
  });
});
