import PDFDocument from 'pdfkit';

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
    email?: string | null;
    phone?: string | null;
  } | null;
  issuerSnapshot: {
    legalName: string;
    tradeName?: string | null;
    taxId: string;
    establishmentCode?: string;
    emissionPointCode?: string;
    address?: string | null;
  } | null;
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  currencyCode: string;
  lines: InvoiceLine[];
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderInvoicePdf(payload: InvoiceIssuedEvent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).font('Helvetica-Bold').text('FACTURA', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').text('Documento electronico - SRI Ecuador', { align: 'center' });
    doc.moveDown(1);

    // Invoice number & date
    doc.fontSize(11).font('Helvetica-Bold').text(`Numero: ${payload.number || 'S/N'}`);
    doc.font('Helvetica').text(`Fecha: ${new Date().toLocaleDateString('es-EC')}`);
    doc.moveDown(0.5);

    // Issuer
    if (payload.issuerSnapshot) {
      doc.fontSize(10).font('Helvetica-Bold').text('Emisor:');
      doc.font('Helvetica').text(`  ${payload.issuerSnapshot.legalName}`);
      doc.text(`  RUC: ${payload.issuerSnapshot.taxId}`);
      if (payload.issuerSnapshot.address) {
        doc.text(`  Dir: ${payload.issuerSnapshot.address}`);
      }
    }
    doc.moveDown(0.5);

    // Customer
    if (payload.customerSnapshot) {
      doc.fontSize(10).font('Helvetica-Bold').text('Cliente:');
      doc.font('Helvetica').text(`  ${payload.customerSnapshot.businessName}`);
      doc.text(`  ID: ${payload.customerSnapshot.identification}`);
      if (payload.customerSnapshot.email) {
        doc.text(`  Email: ${payload.customerSnapshot.email}`);
      }
    }
    doc.moveDown(1);

    // Lines table header
    const tableTop = doc.y;
    const colDesc = 50;
    const colQty = 300;
    const colPrice = 360;
    const colSubtotal = 440;

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Descripcion', colDesc, tableTop, { width: 240 });
    doc.text('Cant.', colQty, tableTop, { width: 50, align: 'right' });
    doc.text('P.Unit', colPrice, tableTop, { width: 70, align: 'right' });
    doc.text('Subtotal', colSubtotal, tableTop, { width: 80, align: 'right' });

    doc.moveTo(50, tableTop + 14).lineTo(530, tableTop + 14).stroke();
    doc.moveDown(0.8);

    // Lines
    doc.font('Helvetica').fontSize(9);
    for (const line of payload.lines) {
      const y = doc.y;
      doc.text(line.description || '-', colDesc, y, { width: 240 });
      doc.text(String(line.quantity), colQty, y, { width: 50, align: 'right' });
      doc.text(formatCents(line.unitPriceCents), colPrice, y, { width: 70, align: 'right' });
      doc.text(formatCents(line.subtotalCents), colSubtotal, y, { width: 80, align: 'right' });
      doc.moveDown(0.6);
    }

    doc.moveTo(50, doc.y).lineTo(530, doc.y).stroke();
    doc.moveDown(0.8);

    // Totals
    const totalsX = 360;
    doc.fontSize(10).font('Helvetica');
    doc.text(`Subtotal: ${payload.currencyCode} ${formatCents(payload.subtotalCents)}`, totalsX, doc.y, { width: 170, align: 'right' });

    // Group taxes by kind
    const taxGroups: Record<string, number> = {};
    for (const line of payload.lines) {
      for (const tax of line.taxes) {
        const key = `${tax.kind} (${tax.rateSnapshot})`;
        taxGroups[key] = (taxGroups[key] || 0) + tax.amountCents;
      }
    }
    for (const [label, amount] of Object.entries(taxGroups)) {
      doc.text(`IVA ${label}: ${payload.currencyCode} ${formatCents(amount)}`, totalsX, doc.y, { width: 170, align: 'right' });
    }

    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(`TOTAL: ${payload.currencyCode} ${formatCents(payload.totalCents)}`, totalsX, doc.y + 4, { width: 170, align: 'right' });

    doc.moveDown(2);

    // Footer
    doc.fontSize(8).font('Helvetica').fillColor('grey');
    doc.text('Documento interno - no valido como comprobante tributario', 50, doc.y, { align: 'center', width: 480 });
    doc.text('Este PDF es una representacion interna. El comprobante oficial del SRI se generara cuando se implemente la integracion.', 50, doc.y + 2, { align: 'center', width: 480 });

    doc.end();
  });
}
