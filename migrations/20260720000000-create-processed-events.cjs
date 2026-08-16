'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('processed_events', {
      event_id: { type: Sequelize.CHAR(36), primaryKey: true },
      processed_at: { type: Sequelize.DATE, allowNull: false },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('processed_events');
  },
};
