import { describe, it, expect } from 'vitest';
import { groupTaxTotals } from '../application/use-cases/shared/recompute-tax-totals.js';
import { LineTax } from '../domain/entities.js';
import type { TaxKind } from '../domain/entities.js';

function makeLineTax(overrides: { invoiceLineId: string; taxRateId: string; kind: TaxKind; rateSnapshot: string; baseCents: number; amountCents: number }): LineTax {
  return LineTax.create(overrides);
}

describe('groupTaxTotals', () => {
  it('groups two lines with the same rate into a single tax total', () => {
    const taxes = [
      makeLineTax({ invoiceLineId: 'l1', taxRateId: 't1', kind: 'vat', rateSnapshot: '15', baseCents: 1000, amountCents: 150 }),
      makeLineTax({ invoiceLineId: 'l2', taxRateId: 't1', kind: 'vat', rateSnapshot: '15', baseCents: 2000, amountCents: 300 }),
    ];

    const groups = groupTaxTotals(taxes);

    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('vat');
    expect(groups[0].rateSnapshot).toBe('15');
    expect(groups[0].baseCents).toBe(3000);
    expect(groups[0].amountCents).toBe(450);
  });

  it('separates two lines with different rates of the same kind', () => {
    const taxes = [
      makeLineTax({ invoiceLineId: 'l1', taxRateId: 't1', kind: 'vat', rateSnapshot: '15', baseCents: 1000, amountCents: 150 }),
      makeLineTax({ invoiceLineId: 'l2', taxRateId: 't2', kind: 'vat', rateSnapshot: '0', baseCents: 2000, amountCents: 0 }),
    ];

    const groups = groupTaxTotals(taxes);

    expect(groups).toHaveLength(2);
    const g15 = groups.find(g => g.rateSnapshot === '15');
    const g0 = groups.find(g => g.rateSnapshot === '0');
    expect(g15!.amountCents).toBe(150);
    expect(g0!.amountCents).toBe(0);
  });

  it('returns empty array for no taxes', () => {
    expect(groupTaxTotals([])).toEqual([]);
  });

  it('groups different kinds separately', () => {
    const taxes = [
      makeLineTax({ invoiceLineId: 'l1', taxRateId: 't1', kind: 'vat', rateSnapshot: '15', baseCents: 1000, amountCents: 150 }),
      makeLineTax({ invoiceLineId: 'l1', taxRateId: 't2', kind: 'withholding_iva', rateSnapshot: '30', baseCents: 1000, amountCents: 300 }),
    ];

    const groups = groupTaxTotals(taxes);

    expect(groups).toHaveLength(2);
    expect(groups.find(g => g.kind === 'vat')!.amountCents).toBe(150);
    expect(groups.find(g => g.kind === 'withholding_iva')!.amountCents).toBe(300);
  });
});
