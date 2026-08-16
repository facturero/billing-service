import { randomUUID } from 'node:crypto';

export type InvoiceStatus = 'draft' | 'issued' | 'voided';
export type TaxKind = 'vat' | 'withholding_iva' | 'withholding_rent' | 'special';

// ── Invoice ────────────────────────────────────────────────────────────────

export interface CustomerSnapshot {
  id: string;
  businessName: string;
  identification: string;
  identificationTypeId: string;
  email: string | null;
  phone: string | null;
  type: 'person' | 'company';
  taxClassification?: string | null;
}

export interface IssuerSnapshot {
  legalName: string;
  tradeName: string | null;
  taxId: string;
  establishmentCode: string;
  emissionPointCode: string;
  address: string | null;
}

export interface InvoiceProps {
  id: string;
  organizationId: string;
  countryCode: string;
  documentTypeId: string;
  number: string | null;
  establishmentId: string | null;
  emissionPointId: string | null;
  customerId: string;
  customerSnapshot: CustomerSnapshot | null;
  issuerSnapshot: IssuerSnapshot | null;
  issueDate: Date | null;
  currencyCode: string;
  subtotalCents: number;
  taxTotalCents: number;
  totalCents: number;
  status: InvoiceStatus;
  voidedAt: Date | null;
  voidedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Invoice {
  private constructor(private props: InvoiceProps) {}

  static create(params: {
    organizationId: string;
    countryCode: string;
    documentTypeId: string;
    customerId: string;
    currencyCode: string;
  }): Invoice {
    const now = new Date();
    return new Invoice({
      id: randomUUID(),
      organizationId: params.organizationId,
      countryCode: params.countryCode,
      documentTypeId: params.documentTypeId,
      number: null,
      establishmentId: null,
      emissionPointId: null,
      customerId: params.customerId,
      customerSnapshot: null,
      issuerSnapshot: null,
      issueDate: null,
      currencyCode: params.currencyCode,
      subtotalCents: 0,
      taxTotalCents: 0,
      totalCents: 0,
      status: 'draft',
      voidedAt: null,
      voidedReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static fromPersistence(props: InvoiceProps): Invoice {
    return new Invoice({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get countryCode(): string { return this.props.countryCode; }
  get documentTypeId(): string { return this.props.documentTypeId; }
  get number(): string | null { return this.props.number; }
  get establishmentId(): string | null { return this.props.establishmentId; }
  get emissionPointId(): string | null { return this.props.emissionPointId; }
  get customerId(): string { return this.props.customerId; }
  get customerSnapshot(): CustomerSnapshot | null { return this.props.customerSnapshot; }
  get issuerSnapshot(): IssuerSnapshot | null { return this.props.issuerSnapshot; }
  get issueDate(): Date | null { return this.props.issueDate; }
  get currencyCode(): string { return this.props.currencyCode; }
  get subtotalCents(): number { return this.props.subtotalCents; }
  get taxTotalCents(): number { return this.props.taxTotalCents; }
  get totalCents(): number { return this.props.totalCents; }
  get status(): InvoiceStatus { return this.props.status; }
  get voidedAt(): Date | null { return this.props.voidedAt; }
  get voidedReason(): string | null { return this.props.voidedReason; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  belongsToOrganization(organizationId: string): boolean {
    return this.props.organizationId === organizationId;
  }

  setCustomerSnapshot(snapshot: CustomerSnapshot): void {
    if (this.props.status !== 'draft') return;
    this.props.customerSnapshot = snapshot;
    this.props.updatedAt = new Date();
  }

  setIssuerSnapshot(snapshot: IssuerSnapshot): void {
    if (this.props.status !== 'draft') return;
    this.props.issuerSnapshot = snapshot;
    this.props.updatedAt = new Date();
  }

  updateTotals(subtotalCents: number, taxTotalCents: number, totalCents: number): void {
    if (this.props.status !== 'draft') return;
    this.props.subtotalCents = subtotalCents;
    this.props.taxTotalCents = taxTotalCents;
    this.props.totalCents = totalCents;
    this.props.updatedAt = new Date();
  }

  issue(sequentialNumber: string, establishmentId: string, emissionPointId: string): void {
    if (this.props.status !== 'draft') {
      throw new Error(`No se puede emitir una factura en estado ${this.props.status}`);
    }
    if (!this.props.customerSnapshot || !this.props.issuerSnapshot) {
      throw new Error('Los snapshots del cliente y emisor deben estar establecidos antes de emitir');
    }
    this.props.number = sequentialNumber;
    this.props.establishmentId = establishmentId;
    this.props.emissionPointId = emissionPointId;
    this.props.issueDate = new Date();
    this.props.status = 'issued';
    this.props.updatedAt = new Date();
  }

  void(reason: string): void {
    if (this.props.status !== 'issued') {
      throw new Error(`No se puede anular una factura en estado ${this.props.status}`);
    }
    this.props.status = 'voided';
    this.props.voidedAt = new Date();
    this.props.voidedReason = reason;
    this.props.updatedAt = new Date();
  }

  toPersistence(): InvoiceProps {
    return { ...this.props };
  }
}

// ── Invoice Line ───────────────────────────────────────────────────────────

export interface ProductSnapshot {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
}

export interface InvoiceLineProps {
  id: string;
  invoiceId: string;
  productId: string;
  productSnapshot: ProductSnapshot | null;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountCents: number;
  subtotalCents: number;
}

export class InvoiceLine {
  private constructor(private props: InvoiceLineProps) {}

  static create(params: {
    invoiceId: string;
    productId: string;
    productSnapshot?: ProductSnapshot;
    description: string;
    quantity: number;
    unitPriceCents: number;
    discountCents?: number;
    subtotalCents?: number;
  }): InvoiceLine {
    return new InvoiceLine({
      id: randomUUID(),
      invoiceId: params.invoiceId,
      productId: params.productId,
      productSnapshot: params.productSnapshot ?? null,
      description: params.description,
      quantity: params.quantity,
      unitPriceCents: params.unitPriceCents,
      discountCents: params.discountCents ?? 0,
      subtotalCents: params.subtotalCents ?? (params.quantity * params.unitPriceCents - (params.discountCents ?? 0)),
    });
  }

  static fromPersistence(props: InvoiceLineProps): InvoiceLine {
    return new InvoiceLine({ ...props });
  }

  get id(): string { return this.props.id; }
  get invoiceId(): string { return this.props.invoiceId; }
  get productId(): string { return this.props.productId; }
  get productSnapshot(): ProductSnapshot | null { return this.props.productSnapshot; }
  get description(): string { return this.props.description; }
  get quantity(): number { return this.props.quantity; }
  get unitPriceCents(): number { return this.props.unitPriceCents; }
  get discountCents(): number { return this.props.discountCents; }
  get subtotalCents(): number { return this.props.subtotalCents; }

  toPersistence(): InvoiceLineProps {
    return { ...this.props };
  }
}

// ── Line Tax ───────────────────────────────────────────────────────────────

export interface LineTaxProps {
  id: string;
  invoiceLineId: string;
  taxRateId: string;
  kind: TaxKind;
  rateSnapshot: string;
  baseCents: number;
  amountCents: number;
}

export class LineTax {
  private constructor(private props: LineTaxProps) {}

  static create(params: {
    invoiceLineId: string;
    taxRateId: string;
    kind: TaxKind;
    rateSnapshot: string;
    baseCents: number;
    amountCents: number;
  }): LineTax {
    return new LineTax({
      id: randomUUID(),
      invoiceLineId: params.invoiceLineId,
      taxRateId: params.taxRateId,
      kind: params.kind,
      rateSnapshot: params.rateSnapshot,
      baseCents: params.baseCents,
      amountCents: params.amountCents,
    });
  }

  static fromPersistence(props: LineTaxProps): LineTax {
    return new LineTax({ ...props });
  }

  get id(): string { return this.props.id; }
  get invoiceLineId(): string { return this.props.invoiceLineId; }
  get taxRateId(): string { return this.props.taxRateId; }
  get kind(): TaxKind { return this.props.kind; }
  get rateSnapshot(): string { return this.props.rateSnapshot; }
  get baseCents(): number { return this.props.baseCents; }
  get amountCents(): number { return this.props.amountCents; }

  toPersistence(): LineTaxProps {
    return { ...this.props };
  }
}

// ── Invoice Tax Total (resumen por tipo de impuesto) ───────────────────────

export interface InvoiceTaxTotalProps {
  id: string;
  invoiceId: string;
  kind: string;
  rateSnapshot: string;
  baseCents: number;
  amountCents: number;
}

export class InvoiceTaxTotal {
  private constructor(private props: InvoiceTaxTotalProps) {}

  static create(params: {
    invoiceId: string;
    kind: string;
    rateSnapshot: string;
    baseCents: number;
    amountCents: number;
  }): InvoiceTaxTotal {
    return new InvoiceTaxTotal({
      id: randomUUID(),
      invoiceId: params.invoiceId,
      kind: params.kind,
      rateSnapshot: params.rateSnapshot,
      baseCents: params.baseCents,
      amountCents: params.amountCents,
    });
  }

  static fromPersistence(props: InvoiceTaxTotalProps): InvoiceTaxTotal {
    return new InvoiceTaxTotal({ ...props });
  }

  get id(): string { return this.props.id; }
  get invoiceId(): string { return this.props.invoiceId; }
  get kind(): string { return this.props.kind; }
  get rateSnapshot(): string { return this.props.rateSnapshot; }
  get baseCents(): number { return this.props.baseCents; }
  get amountCents(): number { return this.props.amountCents; }

  toPersistence(): InvoiceTaxTotalProps {
    return { ...this.props };
  }
}

// ── Sequence ───────────────────────────────────────────────────────────────

export interface SequenceProps {
  id: string;
  organizationId: string;
  countryCode: string;
  establishmentId: string;
  emissionPointId: string;
  documentTypeId: string;
  currentValue: number;
}

export class Sequence {
  private constructor(private props: SequenceProps) {}

  static create(params: {
    organizationId: string;
    countryCode: string;
    establishmentId: string;
    emissionPointId: string;
    documentTypeId: string;
  }): Sequence {
    return new Sequence({
      id: randomUUID(),
      organizationId: params.organizationId,
      countryCode: params.countryCode,
      establishmentId: params.establishmentId,
      emissionPointId: params.emissionPointId,
      documentTypeId: params.documentTypeId,
      currentValue: 0,
    });
  }

  static fromPersistence(props: SequenceProps): Sequence {
    return new Sequence({ ...props });
  }

  get id(): string { return this.props.id; }
  get organizationId(): string { return this.props.organizationId; }
  get countryCode(): string { return this.props.countryCode; }
  get establishmentId(): string { return this.props.establishmentId; }
  get emissionPointId(): string { return this.props.emissionPointId; }
  get documentTypeId(): string { return this.props.documentTypeId; }
  get currentValue(): number { return this.props.currentValue; }

  nextValue(): number {
    this.props.currentValue += 1;
    return this.props.currentValue;
  }

  toPersistence(): SequenceProps {
    return { ...this.props };
  }
}
