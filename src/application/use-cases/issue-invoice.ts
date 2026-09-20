import { randomUUID } from 'node:crypto';
import { InvoiceNotFoundError, BadRequestError, EstablishmentNotFoundError, EmissionPointNotFoundError, EmissionPointInactiveError, MismatchedTotalsError, SequenceNotFoundError } from '../../domain/errors.js';
import { Invoice, Sequence } from '../../domain/entities.js';
import type { CustomerSnapshot } from '../../domain/entities.js';
import { UnitOfWork, OrganizationCatalogPort, CustomerCatalogPort, DocumentTypeCatalogPort, IssuerInfo, EstablishmentInfo, EmissionPointInfo } from '../ports.js';
import { IssueInvoiceInput, InvoiceDetailDTO } from '../dts.js';
import { BusinessRepositories } from '../../domain/repositories.js';
import { invoiceToDetailDTO } from './create-invoice.js';
import { addCents } from '../../domain/value-objects.js';
import { recomputeAndSaveTaxTotals } from './shared/recompute-tax-totals.js';

export interface IssueContext {
  org: IssuerInfo;
  establishment: EstablishmentInfo;
  emissionPoint: EmissionPointInfo;
  establishmentId: string;
  emissionPointId: string;
  userId?: string;
}

/**
 * Cuerpo compartido de la emisión de un comprobante (factura 01 o nota de
 * crédito 04). Usa UNA secuencia por (organización, punto, tipo de documento),
 * valida totales, persiste y dispara billing.invoice.issued con el
 * `documentTypeCode` SRI y, si aplica, las referencias a la factura original.
 * Lo invocan IssueInvoiceUseCase e IssueCreditNoteUseCase dentro de su propio
 * UoW; aquí trabaja sobre `repos` ya transaccionales.
 */
export async function issueInvoiceInTransaction(
  repos: BusinessRepositories,
  invoice: Invoice,
  context: IssueContext,
  deps: { customerCatalog: CustomerCatalogPort; documentTypeCatalog: DocumentTypeCatalogPort },
): Promise<InvoiceDetailDTO> {
  const { org, establishment, emissionPoint, establishmentId, emissionPointId, userId } = context;
  const organizationId = invoice.organizationId;
  const invoiceId = invoice.id;

  // Defensive: set customer snapshot if missing (resilient for pre-Phase-2 invoices).
  // También si le falta el código del tipo de identificación: los borradores
  // creados antes de guardarlo lo necesitan para que fiscal declare bien al comprador.
  if (!invoice.customerSnapshot || !invoice.customerSnapshot.identificationTypeCode) {
    const customerInfo = await deps.customerCatalog.findById(organizationId, invoice.customerId);
    if (customerInfo) {
      const snapshot: CustomerSnapshot = {
        id: customerInfo.id,
        businessName: customerInfo.businessName,
        identification: customerInfo.identification,
        identificationTypeId: customerInfo.identificationTypeId,
        identificationTypeCode: customerInfo.identificationTypeCode,
        email: customerInfo.email,
        phone: customerInfo.phone,
        type: customerInfo.type,
      };
      invoice.setCustomerSnapshot(snapshot);
    }
  }

  // Set issuer snapshot
  invoice.setIssuerSnapshot({
    legalName: org.legalName,
    tradeName: org.tradeName,
    taxId: org.taxId,
    establishmentCode: establishment.code,
    emissionPointCode: emissionPoint.code,
    address: establishment.address,
  });

  // Recálculo y validación de totales ANTES de tomar el lock de secuencia.
  // Esto solo lee líneas/impuestos ya persistidos del borrador (no depende de
  // la secuencia) y escribe tax totals en filas propias. Hacerlo aquí —en vez
  // de dentro de la ventana FOR UPDATE— acorta el hold del lock de la
  // secuencia al mínimo (folio + persistencia), que es lo que serializa las
  // emisiones en paralelo de un mismo punto (TEST-PLAN.md #1).
  const lines = await repos.invoiceLines.findByInvoice(invoiceId);
  const allTaxes: Array<{ id: string; invoiceLineId: string; taxRateId: string; kind: string; rateSnapshot: string; baseCents: number; amountCents: number; }> = [];
  for (const line of lines) {
    const taxes = await repos.lineTaxes.findByInvoiceLine(line.id);
    allTaxes.push(...taxes);
  }

  let calculatedSubtotal = 0;
  let calculatedTaxTotal = 0;
  for (const l of lines) {
    calculatedSubtotal = addCents(calculatedSubtotal, l.subtotalCents);
  }
  for (const t of allTaxes) {
    calculatedTaxTotal = addCents(calculatedTaxTotal, t.amountCents);
  }
  const calculatedTotal = addCents(calculatedSubtotal, calculatedTaxTotal);

  if (calculatedSubtotal !== invoice.subtotalCents || calculatedTotal !== invoice.totalCents) {
    throw new MismatchedTotalsError();
  }

  // Ensure tax totals are up-to-date before issuing
  await recomputeAndSaveTaxTotals(invoiceId, allTaxes as any, repos);

  // Auto-provision sequence if it doesn't exist. El primer SELECT usa
  // `FOR UPDATE` (repo tx-aware): si hay una serie previa, las emisiones en
  // paralelo quedan serializadas sobre la fila y consiguen folios distintos.
  // Si el SELECT vuelve null (primer uso), provisionamos con INSERT ... IGNORE
  // (createIfAbsent) y releemos con lock: del posible "empate" de dos emisiones
  // simultáneas solo sobrevive UNA fila, y la transacción perdedora se
  // serializa sobre la fila ganadora en el re-read (TEST-PLAN.md #1).
  let sequence = await repos.sequences.findByOrganizationAndPoint(
    organizationId, emissionPointId, invoice.documentTypeId,
  );
  if (!sequence) {
    sequence = Sequence.create({
      organizationId,
      countryCode: invoice.countryCode,
      establishmentId,
      emissionPointId,
      documentTypeId: invoice.documentTypeId,
    });
    await repos.sequences.createIfAbsent(sequence);
    sequence = await repos.sequences.findByOrganizationAndPoint(
      organizationId, emissionPointId, invoice.documentTypeId,
    );
    if (!sequence) {
      // Solo alcanzable si otra transacción se dispuso a crear la fila y
      // aún no la ha hecho visible; su INSERT ... IGNORE la creará y la
      // próxima pasada la verá. Fallo limpio en vez de escribir sin folio.
      throw new SequenceNotFoundError();
    }
  }

  const nextVal = sequence.nextValue();
  const seqFormatted = String(nextVal).padStart(9, '0');
  const number = `${establishment.code}-${emissionPoint.code}-${seqFormatted}`;

  // Código SRI del comprobante (01 factura, 04 nota de crédito...): se lo
  // resolvemos al momento de emitir para que el evento indique a fiscal-ecuador
  // qué XML armar. Si el catálogo no responde o el tipo no está seedeado, se
  // asume 01 (solo las NC creadas por el flujo #20 traen un tipo distinto, y
  // esas exigen el tipo 04 en IssueCreditNoteUseCase antes de llegar aquí).
  const documentTypes = await deps.documentTypeCatalog.listByCountry(invoice.countryCode);
  const documentTypeCode = documentTypes.find((t) => t.id === invoice.documentTypeId)?.code ?? '01';

  // Referencias de nota de crédito: factura original + motivo. Solas viajan en
  // el evento; fiscal usa relatedInvoiceId para resolver el numDocModificado y
  // relatedIssueDate como `fechaEmisionDocSustento` (fallback: la fecha con la
  // que fiscal procesó el evento del original).
  const ncRef = invoice.relatedInvoiceId
    ? await (async () => {
        const original = await repos.invoices.findByIdAndOrganization(invoice.relatedInvoiceId!, organizationId);
        return {
          relatedInvoiceId: invoice.relatedInvoiceId!,
          relatedIssueDate: original?.issueDate?.toISOString() ?? null,
          creditNoteReason: invoice.creditNoteReason,
        };
      })()
    : null;

  invoice.issue(number, establishmentId, emissionPointId);
  await repos.sequences.save(sequence);
  await repos.invoices.save(invoice);

  await repos.outbox.add({
    eventId: randomUUID(),
    organizationId: invoice.organizationId,
    type: 'billing.invoice.issued',
    aggregateType: 'invoice',
    aggregateId: invoice.id,
    payload: {
      invoiceId: invoice.id,
      number: invoice.number,
      sequentialNumber: seqFormatted,
      // Fecha legal del comprobante. fiscal-ecuador la usa en fechaEmision y
      // en la clave de acceso; sin ella tomaba la hora a la que procesaba el
      // evento, que puede caer en otro día.
      issueDate: invoice.issueDate?.toISOString() ?? null,
      organizationId: invoice.organizationId,
      // Sin destinatario el gateway descarta el evento y la campana nunca
      // suena; se omite (en vez de mandar '') si la petición no traía X-User-Id.
      ...(userId ? { userId } : {}),
      countryCode: invoice.countryCode,
      // Tipo SRI del comprobante: fiscal arma factura (01) o nota de crédito (04).
      documentTypeCode,
      ...(ncRef ?? {}),
      establishmentId: invoice.establishmentId,
      emissionPointId: invoice.emissionPointId,
      customerSnapshot: invoice.customerSnapshot,
      issuerSnapshot: invoice.issuerSnapshot,
      subtotalCents: invoice.subtotalCents,
      taxTotalCents: invoice.taxTotalCents,
      totalCents: invoice.totalCents,
      currencyCode: invoice.currencyCode,
      lines: lines.map(l => ({
        productId: l.productId,
        // El SKU va al codigoPrincipal del SRI; el UUID interno no cabe (máx. 25).
        productCode: l.productSnapshot?.sku ?? null,
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        discountCents: l.discountCents,
        subtotalCents: l.subtotalCents,
        taxes: allTaxes.filter(t => t.invoiceLineId === l.id).map(t => ({
          taxRateId: t.taxRateId,
          kind: t.kind,
          rateSnapshot: t.rateSnapshot,
          baseCents: t.baseCents,
          amountCents: t.amountCents,
        })),
      })),
    },
    occurredAt: new Date(),
  });

  const linesDTO = lines.map(l => ({
    id: l.id, productId: l.productId, productSnapshot: l.productSnapshot, description: l.description,
    quantity: l.quantity, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents,
    subtotalCents: l.subtotalCents, taxes: [] as any[],
  }));
  const lineTaxDTOs = allTaxes.map(t => ({ id: t.id, invoiceLineId: t.invoiceLineId, taxRateId: t.taxRateId, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));
  const taxTotals = await repos.invoiceTaxTotals.findByInvoice(invoiceId);
  const taxTotalDTOs = taxTotals.map(t => ({ id: t.id, kind: t.kind, rateSnapshot: t.rateSnapshot, baseCents: t.baseCents, amountCents: t.amountCents }));

  return invoiceToDetailDTO(invoice, linesDTO, lineTaxDTOs, taxTotalDTOs);
}

export class IssueInvoiceUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly organizationCatalog: OrganizationCatalogPort,
    private readonly customerCatalog: CustomerCatalogPort,
    private readonly documentTypeCatalog: DocumentTypeCatalogPort,
  ) {}

  async execute(
    organizationId: string,
    invoiceId: string,
    input: IssueInvoiceInput,
  ): Promise<InvoiceDetailDTO> {
    // Resolve external data BEFORE the transaction
    const [org, establishment, emissionPoint] = await Promise.all([
      this.organizationCatalog.getOrganization(organizationId),
      this.organizationCatalog.getEstablishment(organizationId, input.establishmentId),
      this.organizationCatalog.getEmissionPoint(organizationId, input.establishmentId, input.emissionPointId),
    ]);

    if (!org) throw new BadRequestError('El perfil fiscal de la organización no está completo');
    if (!establishment) throw new EstablishmentNotFoundError();
    if (establishment.status !== 'active') throw new EstablishmentNotFoundError();
    if (!emissionPoint) throw new EmissionPointNotFoundError();
    if (emissionPoint.status !== 'active') throw new EmissionPointInactiveError();

    return this.uow.execute(async (repos) => {
      const invoice = await repos.business.invoices.findByIdAndOrganization(invoiceId, organizationId);
      if (!invoice) throw new InvoiceNotFoundError(invoiceId);
      if (invoice.status !== 'draft') throw new BadRequestError('La factura ya fue emitida o anulada');

      return issueInvoiceInTransaction(repos.business, invoice, {
        org,
        establishment,
        emissionPoint,
        establishmentId: input.establishmentId,
        emissionPointId: input.emissionPointId,
        userId: input.userId,
      }, {
        customerCatalog: this.customerCatalog,
        documentTypeCatalog: this.documentTypeCatalog,
      });
    });
  }
}