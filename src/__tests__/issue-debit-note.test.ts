import { describe, it, expect, vi } from 'vitest';
import { IssueDebitNoteUseCase, NO_PRODUCT_ID } from '../application/use-cases/issue-debit-note.js';
import { InvoiceNotFoundError, BadRequestError } from '../domain/errors.js';
import { Invoice, Sequence } from '../domain/entities.js';
import type {
  UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, DocumentTypeCatalogPort, TaxRatePort,
  IssuerInfo, EstablishmentInfo, EmissionPointInfo, CustomerInfo, DocumentTypeInfo,
} from '../application/ports.js';
import type { AllRepositories } from '../domain/repositories.js';

const orgInfo: IssuerInfo = { legalName: 'Mi Empresa', tradeName: 'ME', taxId: '1234567890' };
const establishmentInfo: EstablishmentInfo = { id: 'est-1', code: '001', name: 'Matriz', address: 'Dir', status: 'active' };
const emissionPointInfo: EmissionPointInfo = { id: 'ep-1', code: '001', name: 'Punto 1', status: 'active' };
const customerInfo: CustomerInfo = { id: 'cust-1', identificationTypeId: 't1', identificationTypeCode: 'RUC', identification: '111', businessName: 'Cliente', tradeName: null, email: null, phone: null, type: 'person', status: 'active' };
const documentTypes: DocumentTypeInfo[] = [
  { id: 'doc-1', countryCode: 'EC', code: '01', name: 'Factura' },
  { id: 'doc-4', countryCode: 'EC', code: '04', name: 'Nota de Crédito' },
  { id: 'doc-5', countryCode: 'EC', code: '05', name: 'Nota de Débito' },
];
const customerSnapshot = {
  id: 'cust-1', businessName: 'Cliente', identification: '111', identificationTypeId: 't1', identificationTypeCode: 'RUC',
  email: null, phone: null, type: 'person' as const,
};

const RATES: Record<string, { id: string; percentage: string; kind: string }> = {
  'rate-0': { id: 'rate-0', percentage: '0.00', kind: 'vat' },
  'rate-15': { id: 'rate-15', percentage: '15.00', kind: 'vat' },
  'rate-ret': { id: 'rate-ret', percentage: '10.00', kind: 'withholding_rent' },
};
const taxRates = (): TaxRatePort => ({ findRate: vi.fn(async (_c: string, id: string) => RATES[id] ?? null) });

function makeOriginal(over: Partial<{ status: string; establishmentId: string | null; documentTypeId: string; customerSnapshot: unknown }> = {}): Invoice {
  return Invoice.fromPersistence({
    id: 'inv-1', organizationId: 'org-1', countryCode: 'EC', documentTypeId: over.documentTypeId ?? 'doc-1',
    number: '001-001-000000001', establishmentId: over.establishmentId === undefined ? 'est-1' : over.establishmentId, emissionPointId: 'ep-1',
    customerId: 'cust-1', customerSnapshot: (over.customerSnapshot === undefined ? customerSnapshot : over.customerSnapshot) as never,
    issuerSnapshot: { legalName: 'Mi Empresa', tradeName: 'ME', taxId: '1234567890', establishmentCode: '001', emissionPointCode: '001', address: 'Dir' },
    issueDate: new Date('2026-09-01T10:00:00.000Z'), currencyCode: 'USD', subtotalCents: 2000, taxTotalCents: 300, totalCents: 2300,
    status: (over.status ?? 'issued') as never, voidedAt: null, voidedReason: null, relatedInvoiceId: null, creditNoteReason: null,
    paymentMethodCode: null, posTerminalId: null, posSaleId: null, posTotalsDiffCents: null, createdAt: new Date(), updatedAt: new Date(),
  } as never);
}

function repos(original: Invoice | null) {
  const sequence = Sequence.fromPersistence({ id: 'seq-5', organizationId: 'org-1', countryCode: 'EC', establishmentId: 'est-1', emissionPointId: 'ep-1', documentTypeId: 'doc-5', currentValue: 0 });
  const savedLines: unknown[] = [];
  const savedTaxes: unknown[] = [];
  const savedInvoices: Invoice[] = [];
  const all = {
    business: {
      invoices: {
        save: vi.fn(async (i: Invoice) => { savedInvoices.push(i); }), findById: vi.fn(), findByIdAndOrganization: vi.fn().mockResolvedValue(original),
        findByOrganization: vi.fn(), findByPosSale: vi.fn().mockResolvedValue(null), delete: vi.fn(),
      },
      invoiceLines: { findByInvoice: vi.fn(async () => savedLines), findById: vi.fn(), save: vi.fn(async (l: unknown) => { savedLines.push(l); }), delete: vi.fn() },
      lineTaxes: { findByInvoiceLine: vi.fn(async (id: string) => savedTaxes.filter((t) => (t as { invoiceLineId: string }).invoiceLineId === id)), findByInvoice: vi.fn(async () => savedTaxes), save: vi.fn(async (t: unknown) => { savedTaxes.push(t); }), deleteByInvoiceLine: vi.fn(), deleteByInvoice: vi.fn() },
      invoiceTaxTotals: { findByInvoice: vi.fn().mockResolvedValue([]), save: vi.fn(), deleteByInvoice: vi.fn() },
      sequences: { findByOrganizationAndPoint: vi.fn().mockResolvedValue(sequence), findById: vi.fn(), createIfAbsent: vi.fn(), save: vi.fn() },
      outbox: { add: vi.fn() },
    },
  } as unknown as AllRepositories;
  return { all, savedLines, savedTaxes, savedInvoices };
}

const uowOf = (r: AllRepositories): UnitOfWork => ({ execute: vi.fn(async (fn: (r: AllRepositories) => Promise<never>) => fn(r)) } as unknown as UnitOfWork);

function useCase(r: AllRepositories, types: DocumentTypeInfo[] = documentTypes) {
  const org: OrganizationCatalogPort = {
    getOrganization: vi.fn().mockResolvedValue(orgInfo), getEstablishment: vi.fn().mockResolvedValue(establishmentInfo), getEmissionPoint: vi.fn().mockResolvedValue(emissionPointInfo),
  };
  const customers: CustomerCatalogPort = { findById: vi.fn().mockResolvedValue(customerInfo), findFinalConsumer: vi.fn().mockResolvedValue(null) };
  const docs: DocumentTypeCatalogPort = { listByCountry: vi.fn().mockResolvedValue(types) };
  return new IssueDebitNoteUseCase(uowOf(r), org, customers, docs, taxRates());
}

const base = { establishmentId: 'est-1', emissionPointId: 'ep-1' };
const motives = [
  { reason: 'Intereses por mora', amount: '10.00', taxRateId: 'rate-0' },
  { reason: 'Gastos de cobranza', amount: '4.00', taxRateId: 'rate-15' },
];

describe('IssueDebitNoteUseCase', () => {
  it('emite la nota con una línea por motivo, sus impuestos y el evento con la factura que modifica', async () => {
    const t = repos(makeOriginal());
    const result = await useCase(t.all).execute('org-1', 'inv-1', { ...base, motives });

    expect(result.status).toBe('issued');
    expect(result).toMatchObject({ subtotalCents: 1400, taxTotalCents: 60, totalCents: 1460 });
    // Serie propia del tipo 05.
    expect(t.all.business.sequences.findByOrganizationAndPoint).toHaveBeenCalledWith('org-1', 'ep-1', 'doc-5');
    expect(t.savedLines).toHaveLength(2);
    expect(t.savedTaxes).toHaveLength(2);

    const event = (t.all.business.outbox.add as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(event.type).toBe('billing.invoice.issued');
    expect(event.payload).toMatchObject({
      documentTypeCode: '05', relatedInvoiceId: 'inv-1', relatedIssueDate: '2026-09-01T10:00:00.000Z',
      subtotalCents: 1400, taxTotalCents: 60, totalCents: 1460,
    });
    expect(event.payload.lines.map((l: { description: string; subtotalCents: number; productId: string }) => [l.description, l.subtotalCents, l.productId]))
      .toEqual([['Intereses por mora', 1000, NO_PRODUCT_ID], ['Gastos de cobranza', 400, NO_PRODUCT_ID]]);
    expect(event.payload.lines[1].taxes[0]).toMatchObject({ kind: 'vat', rateSnapshot: '15.00', baseCents: 400, amountCents: 60 });
  });

  it('la forma de pago viaja en el evento', async () => {
    const t = repos(makeOriginal());
    await useCase(t.all).execute('org-1', 'inv-1', { ...base, motives, paymentMethodCode: '19' });
    expect((t.all.business.outbox.add as ReturnType<typeof vi.fn>).mock.calls[0]![0].payload.paymentMethodCode).toBe('19');
  });

  it.each([
    ['sin motivos', { ...base, motives: [] }],
    ['motivo sin razón', { ...base, motives: [{ reason: ' ', amount: '1.00', taxRateId: 'rate-0' }] }],
    ['razón de más de 300 caracteres', { ...base, motives: [{ reason: 'x'.repeat(301), amount: '1.00', taxRateId: 'rate-0' }] }],
    ['valor cero', { ...base, motives: [{ reason: 'Algo', amount: '0.00', taxRateId: 'rate-0' }] }],
    ['impuesto inexistente', { ...base, motives: [{ reason: 'Algo', amount: '1.00', taxRateId: 'no-existe' }] }],
    ['impuesto que no es IVA', { ...base, motives: [{ reason: 'Algo', amount: '1.00', taxRateId: 'rate-ret' }] }],
    ['más de 20 motivos', { ...base, motives: Array.from({ length: 21 }, () => ({ reason: 'Algo', amount: '1.00', taxRateId: 'rate-0' })) }],
  ])('rechaza %s y no emite nada', async (_name, input) => {
    const t = repos(makeOriginal());
    await expect(useCase(t.all).execute('org-1', 'inv-1', input)).rejects.toThrow(BadRequestError);
    expect(t.all.business.outbox.add).not.toHaveBeenCalled();
  });

  it('solo amplía una factura EMITIDA: no un borrador ni una anulada', async () => {
    for (const status of ['draft', 'voided']) {
      const t = repos(makeOriginal({ status }));
      await expect(useCase(t.all).execute('org-1', 'inv-1', { ...base, motives })).rejects.toThrow(BadRequestError);
    }
  });

  it('debe salir del mismo establecimiento y modificar una factura (no una nota de crédito)', async () => {
    const t = repos(makeOriginal());
    await expect(useCase(t.all).execute('org-1', 'inv-1', { ...base, establishmentId: 'est-9', motives })).rejects.toThrow(/mismo establecimiento/);
    const nc = repos(makeOriginal({ documentTypeId: 'doc-4' }));
    await expect(useCase(nc.all).execute('org-1', 'inv-1', { ...base, motives })).rejects.toThrow(/solo modifica una factura/);
  });

  it('sin tipo 05 en el catálogo fiscal no emite', async () => {
    const t = repos(makeOriginal());
    await expect(useCase(t.all, documentTypes.slice(0, 2)).execute('org-1', 'inv-1', { ...base, motives })).rejects.toThrow(/nota de débito \(05\)/);
    expect(t.all.business.outbox.add).not.toHaveBeenCalled();
  });

  it('la factura debe existir y tener cliente', async () => {
    await expect(useCase(repos(null).all).execute('org-1', 'inv-9', { ...base, motives })).rejects.toThrow(InvoiceNotFoundError);
    await expect(useCase(repos(makeOriginal({ customerSnapshot: null })).all).execute('org-1', 'inv-1', { ...base, motives })).rejects.toThrow(/datos del cliente/);
  });
});
