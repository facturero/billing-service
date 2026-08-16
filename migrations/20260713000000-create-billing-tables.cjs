/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('invoices', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      country_code: { type: Sequelize.STRING(2), allowNull: false, defaultValue: 'EC' },
      document_type_id: { type: Sequelize.CHAR(36), allowNull: false },
      number: { type: Sequelize.STRING(30), allowNull: true },
      establishment_id: { type: Sequelize.CHAR(36), allowNull: true },
      emission_point_id: { type: Sequelize.CHAR(36), allowNull: true },
      customer_id: { type: Sequelize.CHAR(36), allowNull: false },
      customer_snapshot: { type: Sequelize.JSON, allowNull: true },
      issuer_snapshot: { type: Sequelize.JSON, allowNull: true },
      issue_date: { type: Sequelize.DATE, allowNull: true },
      currency_code: { type: Sequelize.CHAR(3), allowNull: false, defaultValue: 'USD' },
      subtotal_cents: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      tax_total_cents: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      total_cents: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.ENUM('draft', 'issued', 'voided'), allowNull: false, defaultValue: 'draft' },
      voided_at: { type: Sequelize.DATE, allowNull: true },
      voided_reason: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('invoice_lines', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      invoice_id: { type: Sequelize.CHAR(36), allowNull: false },
      product_id: { type: Sequelize.CHAR(36), allowNull: false },
      product_snapshot: { type: Sequelize.JSON, allowNull: true },
      description: { type: Sequelize.STRING(255), allowNull: false },
      quantity: { type: Sequelize.DECIMAL(18, 6), allowNull: false },
      unit_price_cents: { type: Sequelize.BIGINT, allowNull: false },
      discount_cents: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      subtotal_cents: { type: Sequelize.BIGINT, allowNull: false },
    });

    await queryInterface.createTable('line_taxes', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      invoice_line_id: { type: Sequelize.CHAR(36), allowNull: false },
      tax_rate_id: { type: Sequelize.CHAR(36), allowNull: false },
      kind: { type: Sequelize.STRING(50), allowNull: false },
      rate_snapshot: { type: Sequelize.STRING(20), allowNull: false },
      base_cents: { type: Sequelize.BIGINT, allowNull: false },
      amount_cents: { type: Sequelize.BIGINT, allowNull: false },
    });

    await queryInterface.createTable('invoice_tax_totals', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      invoice_id: { type: Sequelize.CHAR(36), allowNull: false },
      kind: { type: Sequelize.STRING(50), allowNull: false },
      rate_snapshot: { type: Sequelize.STRING(20), allowNull: false },
      base_cents: { type: Sequelize.BIGINT, allowNull: false },
      amount_cents: { type: Sequelize.BIGINT, allowNull: false },
    });

    await queryInterface.createTable('sequences', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      organization_id: { type: Sequelize.CHAR(36), allowNull: false },
      country_code: { type: Sequelize.STRING(2), allowNull: false, defaultValue: 'EC' },
      establishment_id: { type: Sequelize.CHAR(36), allowNull: false },
      emission_point_id: { type: Sequelize.CHAR(36), allowNull: false },
      document_type_id: { type: Sequelize.CHAR(36), allowNull: false },
      current_value: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
    });

    await queryInterface.addIndex('sequences', ['organization_id', 'emission_point_id', 'document_type_id'], { unique: true });

    await queryInterface.createTable('outbox_messages', {
      id: { type: Sequelize.CHAR(36), primaryKey: true },
      aggregate_type: { type: Sequelize.STRING(50), allowNull: false },
      aggregate_id: { type: Sequelize.CHAR(36), allowNull: false },
      type: { type: Sequelize.STRING(100), allowNull: false },
      payload: { type: Sequelize.JSON, allowNull: false },
      occurred_at: { type: Sequelize.DATE, allowNull: false },
      processed_at: { type: Sequelize.DATE, allowNull: true },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('outbox_messages');
    await queryInterface.dropTable('sequences');
    await queryInterface.dropTable('invoice_tax_totals');
    await queryInterface.dropTable('line_taxes');
    await queryInterface.dropTable('invoice_lines');
    await queryInterface.dropTable('invoices');
  },
};
