'use strict';

// Ingesta de ventas del POS: una venta de caja llega ya cobrada y se convierte
// en una factura emitida. Estas columnas son la idempotencia de esa ingesta —
// el POS reintenta una venta hasta que la da por subida (puede perder la
// respuesta y repetirla), y el índice único garantiza que una misma venta de un
// mismo terminal nunca produzca dos facturas.
//
// `pos_totals_diff_cents` guarda la diferencia entre el total que calculó el
// terminal y el que recalcula billing desde el catálogo. Cero es lo normal; un
// valor distinto es la huella de un precio o un IVA que cambió en el CRM
// después de que el terminal se llevara su copia del catálogo.

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'pos_terminal_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('invoices', 'pos_sale_id', {
      type: Sequelize.STRING(64),
      allowNull: true,
    });
    await queryInterface.addColumn('invoices', 'pos_totals_diff_cents', {
      type: Sequelize.BIGINT,
      allowNull: true,
    });

    // Único y parcial por naturaleza: en MySQL los NULL no colisionan entre sí,
    // así que las facturas que no vienen del POS (ambas columnas NULL) quedan
    // fuera del índice y pueden ser tantas como haga falta.
    await queryInterface.addIndex('invoices', ['organization_id', 'pos_terminal_id', 'pos_sale_id'], {
      unique: true,
      name: 'uniq_invoices_pos_sale',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('invoices', 'uniq_invoices_pos_sale');
    await queryInterface.removeColumn('invoices', 'pos_totals_diff_cents');
    await queryInterface.removeColumn('invoices', 'pos_sale_id');
    await queryInterface.removeColumn('invoices', 'pos_terminal_id');
  },
};
