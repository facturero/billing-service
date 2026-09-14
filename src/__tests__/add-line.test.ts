import { describe, it, expect, vi } from 'vitest';
import { AddLineUseCase } from '../application/use-cases/add-line.js';
import { InvoiceNotFoundError, BadRequestError, ProductDisabledError, ProductNotFoundError, ProductCatalogError } from '../domain/errors.js';
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
    relatedInvoiceId: null,
    creditNoteReason: null,
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

type TaxRateCatalog = TaxRatePort;

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
      sequences: { findByOrganizationAndPoint: vi.fn(), findById: vi.fn(), createIfAbsent: vi.fn(), save: vi.fn() },
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

    // La línea guarda importes sin IVA: el precio de $11,50 con IVA es $10,00 de base.
    const line = result.lines[0];
    expect(line.unitPriceCents).toBe(1000);
    expect(line.subtotalCents).toBe(10000);
    const tax = line.taxes[0];
    expect(tax.baseCents).toBe(10000);
    expect(tax.amountCents).toBe(1500);
  });

  /**
   * FACTURACION-BRECHAS.md, N6. Con precio con IVA incluido, 10 × $11,50 es lo
   * que paga el cliente: $115,00, de los que $100,00 son base y $15,00 IVA.
   * Antes la línea guardaba $115,00 como subtotal y el total sumaba el IVA
   * encima: $130,00.
   */
  it('con precio con IVA incluido, el total es lo que paga el cliente (no suma el IVA dos veces)', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const uc = new AddLineUseCase(mockUow(repos), mockProductCatalog({ ...activeProduct, priceIncludesTax: true }), mockTaxRateCatalog());

    await uc.execute('org-1', 'inv-1', { productId: 'prod-1', description: 'Widget x10', quantity: 10, unitPrice: '11.50' });

    expect(invoice.totalCents).toBe(11500);
    expect(invoice.subtotalCents).toBe(10000);
    expect(invoice.taxTotalCents).toBe(1500);
  });

  /**
   * Las mismas reglas que comprueba fiscal-ecuador antes de enviar al SRI:
   * subtotal = cantidad × precio − descuento, base del IVA = subtotal,
   * IVA = base × tarifa, total = subtotal + IVA. Si alguna falla, el SRI rechaza.
   */
  it.each([
    { name: 'precio con IVA y descuento', price: '23.00', qty: 3, discount: 230, includes: true },
    { name: 'muchas unidades con redondeo', price: '0.99', qty: 100, discount: 0, includes: true },
    { name: 'precio sin IVA con descuento', price: '9.99', qty: 7, discount: 150, includes: false },
  ])('la línea cuadra con las reglas del SRI: $name', async ({ price, qty, discount, includes }) => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const uc = new AddLineUseCase(mockUow(repos), mockProductCatalog({ ...activeProduct, priceIncludesTax: includes }), mockTaxRateCatalog());

    const result = await uc.execute('org-1', 'inv-1', { productId: 'prod-1', description: 'x', quantity: qty, unitPrice: price, discountCents: discount });
    const line = result.lines[0];
    const tax = line.taxes[0];

    expect(line.subtotalCents).toBe(qty * line.unitPriceCents - line.discountCents);
    expect(tax.baseCents).toBe(line.subtotalCents);
    expect(tax.amountCents).toBe(Math.round(tax.baseCents * 0.15));
    expect(invoice.totalCents).toBe(invoice.subtotalCents + invoice.taxTotalCents);

    if (includes) {
      // Lo que paga el cliente se aleja del precio de góndola como mucho por redondeo.
      const shelfTotal = qty * Math.round(Number(price) * 100) - discount;
      expect(Math.abs(invoice.totalCents - shelfTotal)).toBeLessThanOrEqual(qty);
    }
  });

  it('con dos impuestos incluidos en el precio, cada uno se calcula sobre la misma base', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const product = { ...activeProduct, priceIncludesTax: true, taxes: [{ taxRateId: 'iva', kind: 'vat' }, { taxRateId: 'otro', kind: 'special' }] };
    const rates: TaxRateCatalog = { findRate: vi.fn(async (_c: string, id: string) => (id === 'iva' ? taxRate15 : { id: 'otro', percentage: '5', kind: 'special' })) };
    const uc = new AddLineUseCase(mockUow(repos), mockProductCatalog(product), rates);

    const result = await uc.execute('org-1', 'inv-1', { productId: 'prod-1', description: 'x', quantity: 1, unitPrice: '12.00' });
    const [iva, otro] = result.lines[0].taxes;

    expect(result.lines[0].subtotalCents).toBe(1000);
    expect(iva).toMatchObject({ baseCents: 1000, amountCents: 150 });
    expect(otro).toMatchObject({ baseCents: 1000, amountCents: 50 });
    expect(invoice.totalCents).toBe(1200);
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

  it('throws ProductNotFoundError when product returns 404 (null)', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    const productCatalog = mockProductCatalog(null);
    const taxRateCatalog = mockTaxRateCatalog();
    const uow = mockUow(repos);
    const uc = new AddLineUseCase(uow, productCatalog, taxRateCatalog);

    await expect(
      uc.execute('org-1', 'inv-1', {
        productId: 'prod-404',
        description: 'Widget',
        quantity: 1,
        unitPrice: '10.00',
      }),
    ).rejects.toThrow(ProductNotFoundError);
  });

  it('propagates ProductCatalogError when catalog is unavailable (5xx/red)', async () => {
    const invoice = makeDraftInvoice();
    const repos = mockRepos(invoice);
    // El port no devuelve null en caída: LANZA, y el use case no debe
    // tragarse el catálogo caído creando una línea sin impuestos (#2).
    const productCatalog: ProductCatalogPort = {
      findById: vi.fn().mockRejectedValue(new ProductCatalogError()),
    };
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
    ).rejects.toThrow(ProductCatalogError);
    expect(repos.business.invoiceLines.save).not.toHaveBeenCalled();
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
