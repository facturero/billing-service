'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.renameColumn('processed_events', 'event_id', 'id');
    await queryInterface.addColumn('processed_events', 'event_type', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('processed_events', 'routing_key', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });
    await queryInterface.addColumn('processed_events', 'payload', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('processed_events', 'status', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'processed',
    });
    await queryInterface.addColumn('processed_events', 'last_error', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('processed_events', 'last_error');
    await queryInterface.removeColumn('processed_events', 'status');
    await queryInterface.removeColumn('processed_events', 'payload');
    await queryInterface.removeColumn('processed_events', 'routing_key');
    await queryInterface.removeColumn('processed_events', 'event_type');
    await queryInterface.renameColumn('processed_events', 'id', 'event_id');
  },
};
