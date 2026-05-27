const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME     || 'cobra',
  user:     process.env.DB_USER     || 'cobra_user',
  password: process.env.DB_PASS     || '',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '-05:00',   // Colombia (COT)
  charset: 'utf8mb4',
});

pool.on = pool.on?.bind(pool);

async function ping() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  console.log('✅  MySQL connected');
}

module.exports = { pool, ping };
