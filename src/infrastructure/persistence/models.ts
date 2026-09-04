import { DataTypes, InferAttributes, InferCreationAttributes, Model } from 'sequelize';
import { sequelize } from './sequelize.js';

// ── Invoice ────────────────────────────────────────────────────────────────

export class InvoiceModel extends Model<
  InferAttributes<InvoiceModel>,
  InferCreationAttributes<InvoiceModel>
> {
  declare id: string;
  declare organization_id: string;
  declare country_code: string;
  declare document_type_id: string;
  declare number: string | null;
  declare establishment_id: string | null;
  declare emission_point_id: string | null;
  declare customer_id: string;
  declare customer_snapshot: unknown | null;
  declare issuer_snapshot: unknown | null;
  declare issue_date: Date | null;
  declare currency_code: string;
  declare subtotal_cents: number;
  declare tax_total_cents: number;
  declare total_cents: number;
  declare status: string;
  declare voided_at: Date | null;
  declare voided_reason: string | null;
  declare created_at: Date;
  declare updated_at: Date;
}

InvoiceModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    country_code: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'EC' },
    document_type_id: { type: DataTypes.CHAR(36), allowNull: false },
    number: { type: DataTypes.STRING(30), allowNull: true },
    establishment_id: { type: DataTypes.CHAR(36), allowNull: true },
    emission_point_id: { type: DataTypes.CHAR(36), allowNull: true },
    customer_id: { type: DataTypes.CHAR(36), allowNull: false },
    customer_snapshot: { type: DataTypes.JSON, allowNull: true },
    issuer_snapshot: { type: DataTypes.JSON, allowNull: true },
    issue_date: { type: DataTypes.DATE, allowNull: true },
    currency_code: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'USD' },
    subtotal_cents: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    tax_total_cents: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    total_cents: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('draft', 'issued', 'voided'), allowNull: false, defaultValue: 'draft' },
    voided_at: { type: DataTypes.DATE, allowNull: true },
    voided_reason: { type: DataTypes.STRING(255), allowNull: true },
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  },
  { sequelize, tableName: 'invoices', timestamps: false },
);

// ── Invoice Lines ──────────────────────────────────────────────────────────

export class InvoiceLineModel extends Model<
  InferAttributes<InvoiceLineModel>,
  InferCreationAttributes<InvoiceLineModel>
> {
  declare id: string;
  declare invoice_id: string;
  declare product_id: string;
  declare product_snapshot: unknown | null;
  declare description: string;
  declare quantity: number;
  declare unit_price_cents: number;
  declare discount_cents: number;
  declare subtotal_cents: number;
}

InvoiceLineModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    invoice_id: { type: DataTypes.CHAR(36), allowNull: false },
    product_id: { type: DataTypes.CHAR(36), allowNull: false },
    product_snapshot: { type: DataTypes.JSON, allowNull: true },
    description: { type: DataTypes.STRING(255), allowNull: false },
    quantity: { type: DataTypes.DECIMAL(18, 6), allowNull: false },
    unit_price_cents: { type: DataTypes.BIGINT, allowNull: false },
    discount_cents: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    subtotal_cents: { type: DataTypes.BIGINT, allowNull: false },
  },
  { sequelize, tableName: 'invoice_lines', timestamps: false },
);

// ── Line Tax ───────────────────────────────────────────────────────────────

export class LineTaxModel extends Model<
  InferAttributes<LineTaxModel>,
  InferCreationAttributes<LineTaxModel>
> {
  declare id: string;
  declare invoice_line_id: string;
  declare tax_rate_id: string;
  declare kind: string;
  declare rate_snapshot: string;
  declare base_cents: number;
  declare amount_cents: number;
}

LineTaxModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    invoice_line_id: { type: DataTypes.CHAR(36), allowNull: false },
    tax_rate_id: { type: DataTypes.CHAR(36), allowNull: false },
    kind: { type: DataTypes.STRING(50), allowNull: false },
    rate_snapshot: { type: DataTypes.STRING(20), allowNull: false },
    base_cents: { type: DataTypes.BIGINT, allowNull: false },
    amount_cents: { type: DataTypes.BIGINT, allowNull: false },
  },
  { sequelize, tableName: 'line_taxes', timestamps: false },
);

// ── Invoice Tax Total ──────────────────────────────────────────────────────

export class InvoiceTaxTotalModel extends Model<
  InferAttributes<InvoiceTaxTotalModel>,
  InferCreationAttributes<InvoiceTaxTotalModel>
> {
  declare id: string;
  declare invoice_id: string;
  declare kind: string;
  declare rate_snapshot: string;
  declare base_cents: number;
  declare amount_cents: number;
}

InvoiceTaxTotalModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    invoice_id: { type: DataTypes.CHAR(36), allowNull: false },
    kind: { type: DataTypes.STRING(50), allowNull: false },
    rate_snapshot: { type: DataTypes.STRING(20), allowNull: false },
    base_cents: { type: DataTypes.BIGINT, allowNull: false },
    amount_cents: { type: DataTypes.BIGINT, allowNull: false },
  },
  { sequelize, tableName: 'invoice_tax_totals', timestamps: false },
);

// ── Sequence ───────────────────────────────────────────────────────────────

export class SequenceModel extends Model<
  InferAttributes<SequenceModel>,
  InferCreationAttributes<SequenceModel>
> {
  declare id: string;
  declare organization_id: string;
  declare country_code: string;
  declare establishment_id: string;
  declare emission_point_id: string;
  declare document_type_id: string;
  declare current_value: number;
}

SequenceModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    organization_id: { type: DataTypes.CHAR(36), allowNull: false },
    country_code: { type: DataTypes.STRING(2), allowNull: false, defaultValue: 'EC' },
    establishment_id: { type: DataTypes.CHAR(36), allowNull: false },
    emission_point_id: { type: DataTypes.CHAR(36), allowNull: false },
    document_type_id: { type: DataTypes.CHAR(36), allowNull: false },
    current_value: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
  },
  {
    sequelize,
    tableName: 'sequences',
    timestamps: false,
    indexes: [
      { unique: true, fields: ['organization_id', 'emission_point_id', 'document_type_id'] },
    ],
  },
);

// ── Outbox ─────────────────────────────────────────────────────────────────

export class OutboxModel extends Model<
  InferAttributes<OutboxModel>,
  InferCreationAttributes<OutboxModel>
> {
  declare id: string;
  declare aggregate_type: string;
  declare aggregate_id: string;
  declare type: string;
  declare payload: unknown;
  declare occurred_at: Date;
  declare processed_at: Date | null;
}

OutboxModel.init(
  {
    id: { type: DataTypes.CHAR(36), primaryKey: true },
    aggregate_type: { type: DataTypes.STRING(50), allowNull: false },
    aggregate_id: { type: DataTypes.CHAR(36), allowNull: false },
    type: { type: DataTypes.STRING(100), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false },
    occurred_at: { type: DataTypes.DATE, allowNull: false },
    processed_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: 'outbox_messages', timestamps: false },
);

// ── Processed Events (idempotencia) ──────────────────────────────────────

export class ProcessedEventModel extends Model<
  InferAttributes<ProcessedEventModel>,
  InferCreationAttributes<ProcessedEventModel>
> {
  declare id: string;
  declare event_type: string;
  declare routing_key: string;
  declare payload: string | null;
  declare status: string;
  declare last_error: string | null;
  declare processed_at: Date;
}

ProcessedEventModel.init(
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    event_type: { type: DataTypes.STRING(100), allowNull: false },
    routing_key: { type: DataTypes.STRING(200), allowNull: false },
    payload: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'processed' },
    last_error: { type: DataTypes.TEXT, allowNull: true },
    processed_at: { type: DataTypes.DATE, allowNull: false },
  },
  { sequelize, tableName: 'processed_events', timestamps: false },
);
