require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('./connection');

async function migrate() {
  const sqlFile = path.join(__dirname, 'migrations/001_initial.sql');
  const sql = fs.readFileSync(sqlFile, 'utf8');
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  const conn = await pool.getConnection();
  try {
    for (const statement of statements) {
      await conn.query(statement);
      console.log('  ran:', statement.slice(0, 60).replace(/\n/g, ' ') + '…');
    }
    console.log('\n✅  Migration complete');
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
