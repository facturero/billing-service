import { Sequelize } from 'sequelize';
import { config } from '../config.js';

export const sequelize = new Sequelize(config.DB_NAME, config.DB_USER, config.DB_PASSWORD, {
  host: config.DB_HOST,
  port: config.DB_PORT,
  dialect: 'mysql',
  logging: config.NODE_ENV === 'development' ? console.log : false,
  define: {
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
  // Sin esto, Sequelize usa el default (max: 5). Con solo 5 conexiones
  // compartidas entre POST /invoices y el polling del outbox-relay en el
  // mismo proceso, la escalera de stress-petitions colapsaba a ~9 RPS con
  // ~99% de conn_error (cola por el pool, no por CPU/RAM del pod).
  //
  // 40, no un valor simbolico: mysql-basic (compartido por las 11 bases)
  // tiene max_connections=151 y hoy usa 6 en total entre todos los
  // servicios; 40 deja de sobra para el resto y evita que el pool sea el
  // techo artificial de la medicion de stress-petitions.
  pool: {
    max: 40,
    min: 0,
    idle: 10000,
  },
});
