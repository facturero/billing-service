import type { LineTax } from '../../../domain/entities.js';
import { InvoiceTaxTotal } from '../../../domain/entities.js';

interface TaxGroup {
  kind: string;
  rateSnapshot: string;
  baseCents: number;
  amountCents: number;
}

export function groupTaxTotals(allLineTaxes: LineTax[]): TaxGroup[] {
  const groups = new Map<string, TaxGroup>();

  for (const lt of allLineTaxes) {
    const key = `${lt.kind}|${lt.rateSnapshot}`;
    const existing = groups.get(key);
    if (existing) {
      existing.baseCents += lt.baseCents;
      existing.amountCents += lt.amountCents;
    } else {
      groups.set(key, {
        kind: lt.kind,
        rateSnapshot: lt.rateSnapshot,
        baseCents: lt.baseCents,
        amountCents: lt.amountCents,
      });
    }
  }

  return Array.from(groups.values());
}

export async function recomputeAndSaveTaxTotals(
  invoiceId: string,
  allLineTaxes: LineTax[],
  repos: { invoiceTaxTotals: { deleteByInvoice(id: string): Promise<void>; save(t: InvoiceTaxTotal): Promise<void> } },
): Promise<void> {
  await repos.invoiceTaxTotals.deleteByInvoice(invoiceId);
  const groups = groupTaxTotals(allLineTaxes);
  for (const g of groups) {
    await repos.invoiceTaxTotals.save(InvoiceTaxTotal.create({ invoiceId, ...g }));
  }
}
