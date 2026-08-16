import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { Invoice, InvoiceLine, LineTax, InvoiceTaxTotal, Sequence } from '../../domain/entities.js';
import { InvoiceRepository, InvoiceLineRepository, LineTaxRepository, InvoiceTaxTotalRepository, SequenceRepository, OutboxRepository } from '../../domain/repositories.js';
import { AllRepositories } from '../../domain/repositories.js';
import { UnitOfWork } from '../../application/ports.js';
import { sequelize } from './sequelize.js';
import { InvoiceModel, InvoiceLineModel, LineTaxModel, InvoiceTaxTotalModel, SequenceModel, OutboxModel } from './models.js';

// ── Invoice Repository ─────────────────────────────────────────────────────

export class SequelizeInvoiceRepository implements InvoiceRepository {
  async findById(id: string): Promise<Invoice | null> {
    const row = await InvoiceModel.findByPk(id);
    return row ? mapInvoice(row) : null;
  }

  async findByIdAndOrganization(id: string, organizationId: string): Promise<Invoice | null> {
    const row = await InvoiceModel.findOne({ where: { id, organization_id: organizationId } });
    return row ? mapInvoice(row) : null;
  }

  async findByOrganization(organizationId: string, params?: { status?: string; customerId?: string; from?: string; to?: string }): Promise<Invoice[]> {
    const where: any = { organization_id: organizationId };
    if (params?.status) where.status = params.status;
    if (params?.customerId) where.customer_id = params.customerId;
    if (params?.from || params?.to) {
      where.issue_date = {};
      if (params.from) where.issue_date[Op.gte] = new Date(params.from);
      if (params.to) where.issue_date[Op.lte] = new Date(params.to);
    }
    const rows = await InvoiceModel.findAll({ where, order: [['created_at', 'DESC']] });
    return rows.map(mapInvoice);
  }

  async save(invoice: Invoice): Promise<void> {
    const p = invoice.toPersistence();
    await InvoiceModel.upsert({
      id: p.id,
      organization_id: p.organizationId,
      country_code: p.countryCode,
      document_type_id: p.documentTypeId,
      number: p.number,
      establishment_id: p.establishmentId,
      emission_point_id: p.emissionPointId,
      customer_id: p.customerId,
      customer_snapshot: p.customerSnapshot as any,
      issuer_snapshot: p.issuerSnapshot as any,
      issue_date: p.issueDate,
      currency_code: p.currencyCode,
      subtotal_cents: p.subtotalCents,
      tax_total_cents: p.taxTotalCents,
      total_cents: p.totalCents,
      status: p.status,
      voided_at: p.voidedAt,
      voided_reason: p.voidedReason,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    });
  }

  async delete(id: string): Promise<void> {
    await InvoiceModel.destroy({ where: { id } });
  }
}

function mapInvoice(row: InvoiceModel): Invoice {
  return Invoice.fromPersistence({
    id: row.id,
    organizationId: row.organization_id,
    countryCode: row.country_code,
    documentTypeId: row.document_type_id,
    number: row.number,
    establishmentId: row.establishment_id,
    emissionPointId: row.emission_point_id,
    customerId: row.customer_id,
    customerSnapshot: row.customer_snapshot as any,
    issuerSnapshot: row.issuer_snapshot as any,
    issueDate: row.issue_date,
    currencyCode: row.currency_code,
    subtotalCents: Number(row.subtotal_cents),
    taxTotalCents: Number(row.tax_total_cents),
    totalCents: Number(row.total_cents),
    status: row.status as any,
    voidedAt: row.voided_at,
    voidedReason: row.voided_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// ── Invoice Line Repository ────────────────────────────────────────────────

export class SequelizeInvoiceLineRepository implements InvoiceLineRepository {
  async findByInvoice(invoiceId: string): Promise<InvoiceLine[]> {
    const rows = await InvoiceLineModel.findAll({ where: { invoice_id: invoiceId } });
    return rows.map(mapInvoiceLine);
  }

  async findById(id: string): Promise<InvoiceLine | null> {
    const row = await InvoiceLineModel.findByPk(id);
    return row ? mapInvoiceLine(row) : null;
  }

  async save(line: InvoiceLine): Promise<void> {
    const p = line.toPersistence();
    await InvoiceLineModel.upsert({
      id: p.id,
      invoice_id: p.invoiceId,
      product_id: p.productId,
      product_snapshot: p.productSnapshot as any,
      description: p.description,
      quantity: p.quantity,
      unit_price_cents: p.unitPriceCents,
      discount_cents: p.discountCents,
      subtotal_cents: p.subtotalCents,
    });
  }

  async delete(id: string): Promise<void> {
    await InvoiceLineModel.destroy({ where: { id } });
  }
}

function mapInvoiceLine(row: InvoiceLineModel): InvoiceLine {
  return InvoiceLine.fromPersistence({
    id: row.id,
    invoiceId: row.invoice_id,
    productId: row.product_id,
    productSnapshot: row.product_snapshot as any,
    description: row.description,
    quantity: Number(row.quantity),
    unitPriceCents: Number(row.unit_price_cents),
    discountCents: Number(row.discount_cents),
    subtotalCents: Number(row.subtotal_cents),
  });
}

// ── Line Tax Repository ────────────────────────────────────────────────────

export class SequelizeLineTaxRepository implements LineTaxRepository {
  async findByInvoiceLine(invoiceLineId: string): Promise<LineTax[]> {
    const rows = await LineTaxModel.findAll({ where: { invoice_line_id: invoiceLineId } });
    return rows.map(mapLineTax);
  }

  async findByInvoice(invoiceId: string): Promise<LineTax[]> {
    const lines = await InvoiceLineModel.findAll({ where: { invoice_id: invoiceId } });
    if (lines.length === 0) return [];
    const lineIds = lines.map(l => l.id);
    const rows = await LineTaxModel.findAll({ where: { invoice_line_id: lineIds } });
    return rows.map(mapLineTax);
  }

  async save(lineTax: LineTax): Promise<void> {
    const p = lineTax.toPersistence();
    await LineTaxModel.upsert({
      id: p.id,
      invoice_line_id: p.invoiceLineId,
      tax_rate_id: p.taxRateId,
      kind: p.kind,
      rate_snapshot: p.rateSnapshot,
      base_cents: p.baseCents,
      amount_cents: p.amountCents,
    });
  }

  async deleteByInvoiceLine(invoiceLineId: string): Promise<void> {
    await LineTaxModel.destroy({ where: { invoice_line_id: invoiceLineId } });
  }

  async deleteByInvoice(invoiceId: string): Promise<void> {
    const lines = await InvoiceLineModel.findAll({ where: { invoice_id: invoiceId } });
    for (const line of lines) {
      await LineTaxModel.destroy({ where: { invoice_line_id: line.id } });
    }
  }
}

function mapLineTax(row: LineTaxModel): LineTax {
  return LineTax.fromPersistence({
    id: row.id,
    invoiceLineId: row.invoice_line_id,
    taxRateId: row.tax_rate_id,
    kind: row.kind as any,
    rateSnapshot: row.rate_snapshot,
    baseCents: Number(row.base_cents),
    amountCents: Number(row.amount_cents),
  });
}

// ── Invoice Tax Total Repository ───────────────────────────────────────────

export class SequelizeInvoiceTaxTotalRepository implements InvoiceTaxTotalRepository {
  async findByInvoice(invoiceId: string): Promise<InvoiceTaxTotal[]> {
    const rows = await InvoiceTaxTotalModel.findAll({ where: { invoice_id: invoiceId } });
    return rows.map(r => InvoiceTaxTotal.fromPersistence({
      id: r.id,
      invoiceId: r.invoice_id,
      kind: r.kind,
      rateSnapshot: r.rate_snapshot,
      baseCents: Number(r.base_cents),
      amountCents: Number(r.amount_cents),
    }));
  }

  async save(taxTotal: InvoiceTaxTotal): Promise<void> {
    const p = taxTotal.toPersistence();
    await InvoiceTaxTotalModel.upsert({
      id: p.id,
      invoice_id: p.invoiceId,
      kind: p.kind,
      rate_snapshot: p.rateSnapshot,
      base_cents: p.baseCents,
      amount_cents: p.amountCents,
    });
  }

  async deleteByInvoice(invoiceId: string): Promise<void> {
    await InvoiceTaxTotalModel.destroy({ where: { invoice_id: invoiceId } });
  }
}

// ── Sequence Repository ────────────────────────────────────────────────────

export class SequelizeSequenceRepository implements SequenceRepository {
  async findByOrganizationAndPoint(organizationId: string, emissionPointId: string, documentTypeId: string): Promise<Sequence | null> {
    const row = await SequenceModel.findOne({
      where: {
        organization_id: organizationId,
        emission_point_id: emissionPointId,
        document_type_id: documentTypeId,
      },
    });
    return row ? Sequence.fromPersistence({
      id: row.id,
      organizationId: row.organization_id,
      countryCode: row.country_code,
      establishmentId: row.establishment_id,
      emissionPointId: row.emission_point_id,
      documentTypeId: row.document_type_id,
      currentValue: Number(row.current_value),
    }) : null;
  }

  async findById(id: string): Promise<Sequence | null> {
    const row = await SequenceModel.findByPk(id);
    return row ? Sequence.fromPersistence({
      id: row.id,
      organizationId: row.organization_id,
      countryCode: row.country_code,
      establishmentId: row.establishment_id,
      emissionPointId: row.emission_point_id,
      documentTypeId: row.document_type_id,
      currentValue: Number(row.current_value),
    }) : null;
  }

  async save(sequence: Sequence): Promise<void> {
    const p = sequence.toPersistence();
    await SequenceModel.upsert({
      id: p.id,
      organization_id: p.organizationId,
      country_code: p.countryCode,
      establishment_id: p.establishmentId,
      emission_point_id: p.emissionPointId,
      document_type_id: p.documentTypeId,
      current_value: p.currentValue,
    });
  }
}

// ── Outbox Repository ──────────────────────────────────────────────────────

export class SequelizeOutboxRepository implements OutboxRepository {
  async add(entry: {
    eventId: string;
    organizationId: string;
    type: string;
    aggregateType: string;
    aggregateId: string;
    payload: unknown;
    occurredAt: Date;
  }): Promise<void> {
    await OutboxModel.create({
      id: entry.eventId,
      aggregate_type: entry.aggregateType,
      aggregate_id: entry.aggregateId,
      type: entry.type,
      payload: entry.payload as any,
      occurred_at: entry.occurredAt,
      processed_at: null,
    });
  }
}

// ── Unit of Work ───────────────────────────────────────────────────────────

export class SequelizeUnitOfWork implements UnitOfWork {
  async execute<T>(fn: (repos: AllRepositories) => Promise<T>): Promise<T> {
    const transaction = await sequelize.transaction();
    try {
      const result = await fn({
        business: {
          invoices: new SequelizeInvoiceRepository(),
          invoiceLines: new SequelizeInvoiceLineRepository(),
          lineTaxes: new SequelizeLineTaxRepository(),
          invoiceTaxTotals: new SequelizeInvoiceTaxTotalRepository(),
          sequences: new SequelizeSequenceRepository(),
          outbox: new SequelizeOutboxRepository(),
        },
      });
      await transaction.commit();
      return result;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
