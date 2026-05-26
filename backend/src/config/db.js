// src/config/db.js — Pool de conexão MySQL2 (Promise API)
'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

// Suporta tanto DATABASE_URL (Aiven/cloud) quanto variáveis separadas (local)
let pool;

if (process.env.DATABASE_URL) {
  // Deploy em nuvem (Aiven, PlanetScale, etc.)
  pool = mysql.createPool(process.env.DATABASE_URL);
} else {
  // Desenvolvimento local — variáveis do .env
  pool = mysql.createPool({
    host:               process.env.DB_HOST     || 'localhost',
    port:               parseInt(process.env.DB_PORT || '3306', 10),
    database:           process.env.DB_NAME     || 'siga_mf',
    user:               process.env.DB_USER     || 'root',
    password:           process.env.DB_PASSWORD || '',
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
    timezone:           '-03:00',
    charset:            'utf8mb4',
    enableKeepAlive:    true,
    keepAliveInitialDelay: 10000,
  });
}

// Teste de conexão para o log
pool.getConnection()
    .then(conn => {
        console.log('[DB] Conectado ao MySQL com sucesso!');
        conn.release();
    })
    .catch(err => {
        console.error('[DB] Falha ao conectar:', err.message);
    });

module.exports = pool;
