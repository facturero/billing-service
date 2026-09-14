'use strict';

// Nota de crédito (#20): la NC es un invoice más con document_type_id del tipo
// 04. Estas columnas guardan la referencia a la factura original y el motivo
// (obligatorio en el campo `motivo` del SRI). Se incluyen en el evento
// billing.invoice.issued para que fiscal-ecuador arme el XML 04.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'related_invoice_id', {
      type: Sequelize.CHAR(36),
      allowNull: true,
    });
    await queryInterface.addColumn('invoices', 'credit_note_reason', {
      type: Sequelize.STRING(300),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('invoices', 'credit_note_reason');
    await queryInterface.removeColumn('invoices', 'related_invoice_id');
  },
};