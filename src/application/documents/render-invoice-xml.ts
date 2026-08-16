interface TaxLine {
  taxRateId: string;
  kind: string;
  rateSnapshot: string;
  baseCents: number;
  amountCents: number;
}

interface InvoiceLine {
  productId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  subtotalCents: number;
  taxes: TaxLine[];
}

interface InvoiceIssuedEvent {
  invoiceId: string;
  number: string;
  organizationId: string;
  countryCode: string;
  customerSnapshot: {
    businessName: string;
    identification: string;
  } | null;
  issuerSnapshot: {
    legalName: string;
    taxId: string;
  } | null;
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  currencyCode: string;
  lines: InvoiceLine[];
}

function esc(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function centsToStr(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function renderInvoiceXml(payload: InvoiceIssuedEvent): string {
  const lines = payload.lines.map((l) => {
    const taxes = l.taxes.map(
      (t) => `        <tax taxRateId="${esc(t.taxRateId)}" kind="${esc(t.kind)}" rate="${esc(t.rateSnapshot)}" base="${centsToStr(t.baseCents)}" amount="${centsToStr(t.amountCents)}"/>`,
    ).join('\n');

    return `      <line>
        <description>${esc(l.description)}</description>
        <quantity>${l.quantity}</quantity>
        <unitPrice>${centsToStr(l.unitPriceCents)}</unitPrice>
        <subtotal>${centsToStr(l.subtotalCents)}</subtotal>
${taxes}
      </line>`;
  }).join('\n');

  // Group taxes by kind for totals
  const taxGroups: Record<string, { baseCents: number; amountCents: number }> = {};
  for (const line of payload.lines) {
    for (const tax of line.taxes) {
      const key = tax.kind;
      if (!taxGroups[key]) taxGroups[key] = { baseCents: 0, amountCents: 0 };
      taxGroups[key].baseCents += tax.baseCents;
      taxGroups[key].amountCents += tax.amountCents;
    }
  }

  const taxTotals = Object.entries(taxGroups).map(
    ([kind, t]) => `      <tax kind="${esc(kind)}" base="${centsToStr(t.baseCents)}" amount="${centsToStr(t.amountCents)}"/>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<invoice schemaVersion="generic-v1">
  <number>${esc(payload.number)}</number>
  <issuer>
    <legalName>${esc(payload.issuerSnapshot?.legalName)}</legalName>
    <taxId>${esc(payload.issuerSnapshot?.taxId)}</taxId>
  </issuer>
  <customer>
    <businessName>${esc(payload.customerSnapshot?.businessName)}</businessName>
    <identification>${esc(payload.customerSnapshot?.identification)}</identification>
  </customer>
  <lines>
${lines}
  </lines>
  <totals>
    <subtotal>${centsToStr(payload.subtotalCents)}</subtotal>
    <tax>
${taxTotals}
    </tax>
    <total>${centsToStr(payload.totalCents)}</total>
    <currencyCode>${esc(payload.currencyCode)}</currencyCode>
  </totals>
</invoice>
`;
}
