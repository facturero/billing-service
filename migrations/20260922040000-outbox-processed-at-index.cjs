'use strict';

// A outbox_messages le faltaba el indice sobre processed_at que SI tienen
// auth_db, product_db y customer_db (mismo patron de outbox-relay en las 4
// bases) - se omitio en la migracion original (20260713000000). Sin el, el
// polling del relay (SELECT ... WHERE processed_at IS NULL ORDER BY
// occurred_at FOR UPDATE SKIP LOCKED) hace un table scan completo, y en
// REPEATABLE READ eso toma next-key locks sobre toda la tabla + el gap
// final, bloqueando los INSERT nuevos mientras dura el escaneo. Con la
// tabla ya en ~27k filas (por las pruebas de carga) el escaneo es lento y
// bajo escritura concurrente los INSERT se encolan hasta superar el timeout
// del cliente - medido en stress-petitions: 0% error a 10 RPS, ~99.9% error
// a 25 RPS+, "MySQL / bloqueos" como causa en las 6 corridas.

module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('outbox_messages', ['processed_at']);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('outbox_messages', ['processed_at']);
  },
};
