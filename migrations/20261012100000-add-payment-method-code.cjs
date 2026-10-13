'use strict';

// Forma de pago de la factura (Tabla 24 del SRI: 01 efectivo / sin utilización del sistema financiero, 16 tarjeta de débito,
// 19 tarjeta de crédito, 20 otros con utilización del sistema financiero, etc.). Hasta ahora fiscal-ecuador mandaba siempre
// «01»; ahora la caja web la elige y viaja en el evento de emisión. NULL = no se indicó: fiscal sigue usando su valor por
// defecto, así que las facturas que ya existen y las del CRM no cambian.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invoices', 'payment_method_code', {
      type: Sequelize.CHAR(2),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('invoices', 'payment_method_code');
  },
};
