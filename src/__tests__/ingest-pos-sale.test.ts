import { describe, it, expect, vi } from 'vitest';
import { IngestPosSaleUseCase } from '../application/use-cases/ingest-pos-sale.js';
import { BadRequestError, CustomerNotFoundError, EmissionPointInactiveError } from '../domain/errors.js';
import { Invoice, InvoiceLine, LineTax, Sequence } from '../domain/entities.js';
import type {
  UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, DocumentTypeCatalogPort,
  ProductCatalogPort, TaxRatePort, IssuerInfo, EstablishmentInfo, EmissionPointInfo,
  CustomerInfo, DocumentTypeInfo, ProductCatalogInfo,
} from '../application/ports.js';
import type { AllRepositories } from '../domain/repositories.js';

const orgInfo: IssuerInfo = { legalName: 'Mi Empresa', tradeName: 'ME', taxId: '1234567890' };
const establishmentInfo: EstablishmentInfo = { id: 'est-1', code: '001', name: 'Matriz', address: 'Dir', status: 'active' };
const emissionPointInfo: EmissionPointInfo = { id: 'ep-1', code: '002', name: 'Caja 1', status: 'active' };

const finalConsumer: CustomerInfo = {
  id: 'cust-cf', identificationTypeId: 't-cf', identificationTypeCode: 'CONSUMIDOR_FINAL',
  identification: '9999999999999', businessName: 'CONSUMIDOR FINAL', tradeName: null,
  email: null, phone: null, type: 'person', status: 'active',
};
const namedCustomer: CustomerInfo = { ...finalConsumer, id: 'cust-1', identification: '0102030405', businessName: 'Cliente', identificationTypeCode: 'CEDULA' };

const documentTypes: DocumentTypeInfo[] = [
  { id: 'doc-1', countryCode: 'EC', code: '01', name: 'Factura' },
  { id: 'doc-4', countryCode: 'EC', code: '04', name: 'Nota de Crédito' },
];

// $1,00 con IVA 12% incluido: la base son 89 centavos y el impuesto 11.
const product: ProductCatalogInfo = {
  id: 'prod-1', name: 'Cola 500ml', sku: 'COLA-500', unit: 'u', status: 'active',
  priceIncludesTax: true, taxes: [{ taxRateId: 'rate-12', kind: 'vat' }],
};

function mockOrgCatalog(ep: EmissionPointInfo | null = emissionPointInfo): OrganizationCatalogPort {
  return {
    getOrganization: vi.fn().mockResolvedValue(orgInfo),
    getEstablishment: vi.fn().mockResolvedValue(establishmentInfo),
    getEmissionPoint: vi.fn().mockResolvedValue(ep),
  };
}

function mockCustomerCatalog(): CustomerCatalogPort {
  return {
    findById: vi.fn().mockResolvedValue(namedCustomer),
    findFinalConsumer: vi.fn().mockResolvedValue(finalConsumer),
  };
}

function mockCatalogs() {
  const productCatalog: ProductCatalogPort = { findById: vi.fn().mockResolvedValue(product) };
  const taxRateCatalog: TaxRatePort = { findRate: vi.fn().mockResolvedValue({ id: 'rate-12', percentage: '12', kind: 'vat' }) };
  const documentTypeCatalog: DocumentTypeCatalogPort = { listByCountry: vi.fn().mockResolvedValue(documentTypes) };
  return { productCatalog, taxRateCatalog, documentTypeCatalog };
}

/**
 * Repos en memoria: la ingesta encadena crear + líneas + emitir dentro de una
 * sola transacción, así que las lecturas tienen que ver lo que acaban de
 * escribir los pasos anteriores (a diferencia de los tests de un solo paso).
 */
function mockRepos(existingPosInvoice: Invoice | null = null): AllRepositories & { saved: Invoice[] } {
  const lines: InvoiceLine[] = [];
  const lineTaxes: LineTax[] = [];
  const saved: Invoice[] = [];
  return {
    saved,
    business: {
      invoices: {
        save: vi.fn().mockImplementation((inv: Invoice) => { saved.push(inv); }),
        findById: vi.fn(),
        findByIdAndOrganization: vi.fn(),
        findByOrganization: vi.fn(),
        findByPosSale: vi.fn().mockResolvedValue(existingPosInvoice),
        delete: vi.fn(),
      },
      invoiceLines: {
        findByInvoice: vi.fn().mockImplementation(() => Promise.resolve(lines)),
        findById: vi.fn(),
        save: vi.fn().mockImplementation((l: InvoiceLine) => { lines.push(l); }),
        delete: vi.fn(),
      },
      lineTaxes: {
        findByInvoiceLine: vi.fn().mockImplementation((id: string) => Promise.resolve(lineTaxes.filter((t) => t.invoiceLineId === id))),
        findByInvoice: vi.fn().mockImplementation(() => Promise.resolve(lineTaxes)),
        save: vi.fn().mockImplementation((t: LineTax) => { lineTaxes.push(t); }),
        deleteByInvoiceLine: vi.fn(),
        deleteByInvoice: vi.fn(),
      },
      invoiceTaxTotals: { findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoice: vi.fn() },
      sequences: {
        findByOrganizationAndPoint: vi.fn().mockResolvedValue(Sequence.fromPersistence({
          id: 'seq-1', organizationId: 'org-1', countryCode: 'EC',
          establishmentId: 'est-1', emissionPointId: 'ep-1', documentTypeId: 'doc-1', currentValue: 40,
        })),
        findById: vi.fn(),
        createIfAbsent: vi.fn(),
        save: vi.fn(),
      },
      outbox: { add: vi.fn() },
    },
  } as AllRepositories & { saved: Invoice[] };
}

function mockUow(repos: AllRepositories): UnitOfWork {
  return { execute: vi.fn().mockImplementation(async (fn: (r: AllRepositories) => Promise<unknown>) => fn(repos)) };
}

function makeUseCase(repos: AllRepositories, orgCatalog = mockOrgCatalog(), customerCatalog = mockCustomerCatalog()) {
  const { productCatalog, taxRateCatalog, documentTypeCatalog } = mockCatalogs();
  return {
    useCase: new IngestPosSaleUseCase(mockUow(repos), orgCatalog, customerCatalog, documentTypeCatalog, productCatalog, taxRateCatalog),
    customerCatalog,
  };
}

const sale = {
  terminalId: 'term-7',
  posSaleId: '412',
  establishmentId: 'est-1',
  emissionPointId: 'ep-1',
  lines: [{ productId: 'prod-1', description: 'Cola 500ml', quantity: 2, unitPrice: '1.00' }],
};

describe('IngestPosSaleUseCase', () => {
  it('convierte la venta en una factura ya emitida, numerada por el punto de emisión del terminal', async () => {
    const repos = mockRepos();
    const { useCase } = makeUseCase(repos);

    const { invoice, alreadyIngested } = await useCase.execute('org-1', 'EC', sale);

    expect(alreadyIngested).toBe(false);
    expect(invoice.status).toBe('issued');
    expect(invoice.number).toBe('001-002-000000041');
    expect(invoice.posTerminalId).toBe('term-7');
    expect(invoice.posSaleId).toBe('412');
    // 2 × $1,00 con IVA incluido: base 178, IVA 21, total 199.
    expect(invoice.subtotalCents).toBe(178);
    expect(invoice.totalCents).toBe(199);
    expect(repos.business.outbox.add).toHaveBeenCalled();
  });

  it('sin cliente factura al CONSUMIDOR FINAL de la organización', async () => {
    const repos = mockRepos();
    const { useCase, customerCatalog } = makeUseCase(repos);

    const { invoice } = await useCase.execute('org-1', 'EC', sale);

    expect(customerCatalog.findFinalConsumer).toHaveBeenCalledWith('org-1');
    expect(invoice.customerId).toBe('cust-cf');
    expect((invoice.customerSnapshot as { identification: string }).identification).toBe('9999999999999');
  });

  it('con cliente del CRM factura a ese cliente', async () => {
    const repos = mockRepos();
    const { useCase, customerCatalog } = makeUseCase(repos);

    const { invoice } = await useCase.execute('org-1', 'EC', { ...sale, customerId: 'cust-1' });

    expect(customerCatalog.findById).toHaveBeenCalledWith('org-1', 'cust-1');
    expect(customerCatalog.findFinalConsumer).not.toHaveBeenCalled();
    expect(invoice.customerId).toBe('cust-1');
  });

  it('si la venta ya estaba ingresada devuelve la misma factura sin crear otra', async () => {
    const yaIngresada = Invoice.fromPersistence({
      id: 'inv-previa', organizationId: 'org-1', countryCode: 'EC', documentTypeId: 'doc-1',
      number: '001-002-000000041', establishmentId: 'est-1', emissionPointId: 'ep-1',
      customerId: 'cust-cf', customerSnapshot: null, issuerSnapshot: null, issueDate: new Date(),
      currencyCode: 'USD', subtotalCents: 178, taxTotalCents: 21, totalCents: 199,
      status: 'issued', voidedAt: null, voidedReason: null, relatedInvoiceId: null, creditNoteReason: null,
      posTerminalId: 'term-7', posSaleId: '412', posTotalsDiffCents: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const repos = mockRepos(yaIngresada);
    const { useCase } = makeUseCase(repos);

    const { invoice, alreadyIngested } = await useCase.execute('org-1', 'EC', sale);

    expect(alreadyIngested).toBe(true);
    expect(invoice.id).toBe('inv-previa');
    expect(repos.business.invoices.save).not.toHaveBeenCalled();
    expect(repos.business.outbox.add).not.toHaveBeenCalled();
  });

  it('si el total del terminal no cuadra, factura por lo recalculado y anota la diferencia', async () => {
    const repos = mockRepos();
    const { useCase } = makeUseCase(repos);

    // El terminal traía $2,10 (precio viejo); billing recalcula $1,99.
    const { invoice } = await useCase.execute('org-1', 'EC', { ...sale, posTotalCents: 210 });

    expect(invoice.totalCents).toBe(199);
    expect(invoice.posTotalsDiffCents).toBe(11);
  });

  it('no anota diferencia cuando los totales coinciden', async () => {
    const repos = mockRepos();
    const { useCase } = makeUseCase(repos);

    const { invoice } = await useCase.execute('org-1', 'EC', { ...sale, posTotalCents: 199 });

    expect(invoice.posTotalsDiffCents).toBeNull();
  });

  it('rechaza una venta sin líneas', async () => {
    const repos = mockRepos();
    const { useCase } = makeUseCase(repos);

    await expect(useCase.execute('org-1', 'EC', { ...sale, lines: [] })).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rechaza si el punto de emisión del terminal está inactivo', async () => {
    const repos = mockRepos();
    const { useCase } = makeUseCase(repos, mockOrgCatalog({ ...emissionPointInfo, status: 'inactive' }));

    await expect(useCase.execute('org-1', 'EC', sale)).rejects.toBeInstanceOf(EmissionPointInactiveError);
  });

  it('rechaza si la organización no tiene CONSUMIDOR FINAL', async () => {
    const repos = mockRepos();
    const customerCatalog: CustomerCatalogPort = {
      findById: vi.fn().mockResolvedValue(null),
      findFinalConsumer: vi.fn().mockResolvedValue(null),
    };
    const { useCase } = makeUseCase(repos, mockOrgCatalog(), customerCatalog);

    await expect(useCase.execute('org-1', 'EC', sale)).rejects.toBeInstanceOf(CustomerNotFoundError);
  });
});
