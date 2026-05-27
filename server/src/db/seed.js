/**
 * Seed – inserts Real Confort MD demo data
 * Run: node src/db/seed.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./connection');

const NAMES = [
  'María García','Jorge Rodríguez','Sandra López','Carlos Martínez',
  'Ana Hernández','Luis Torres','Patricia Gómez','Roberto Díaz',
  'Claudia Vargas','Miguel Pérez','Lucía Castro','Fernando Ríos',
  'Adriana Morales','Andrés Salazar','Marcela Jiménez',
];

function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function daysFromNow(n) { return daysAgo(-n); }

async function seed() {
  const conn = await pool.getConnection();
  try {
    // ── Tenant ──────────────────────────────────────────────
    await conn.query(`
      INSERT IGNORE INTO tenants (id,name,slug,wa_number,plan)
      VALUES (1,'Real Confort MD','real-confort-md','+573001234567','premier')
    `);

    // ── Admin user ──────────────────────────────────────────
    const hash = await bcrypt.hash('cobra2024', 12);
    await conn.query(`
      INSERT IGNORE INTO users (id,tenant_id,name,email,password_hash,role)
      VALUES (1,1,'Admin Cobra','admin@realconfort.co',?,'admin')
    `, [hash]);

    // ── Clients ─────────────────────────────────────────────
    for (let i = 0; i < NAMES.length; i++) {
      const name  = NAMES[i];
      const phone = `+5731${String(rnd(0,9))}${String(rnd(10000000,99999999))}`;
      const risk  = rnd(20, 85);
      await conn.query(`
        INSERT IGNORE INTO clients (id,tenant_id,name,phone,cedula,risk_score,income_day)
        VALUES (?,1,?,?,?,?,?)
      `, [i+1, name, phone, `100${rnd(100000,999999)}`, risk, rnd(1,28)]);
    }

    // ── Credits ─────────────────────────────────────────────
    const statuses = ['pagado','pagado','vigente','vigente','mora','mora','mora','porvencer'];
    for (let i = 0; i < 20; i++) {
      const clientId  = rnd(1, NAMES.length);
      const cuota     = rnd(8, 35) * 10000;
      const total     = cuota * rnd(6, 24);
      const status    = statuses[rnd(0, statuses.length - 1)];
      let dueDate, diasMora = 0, stage = 0;

      if (status === 'mora') {
        diasMora = rnd(1, 45);
        dueDate  = daysAgo(diasMora);
        stage    = diasMora >= 4 ? 3 : diasMora >= 1 ? 2 : 1;
      } else if (status === 'porvencer') {
        dueDate = daysFromNow(rnd(1, 5));
      } else if (status === 'pagado') {
        dueDate = daysAgo(rnd(10, 90));
      } else {
        dueDate = daysFromNow(rnd(6, 30));
      }

      await conn.query(`
        INSERT IGNORE INTO credits
          (id,tenant_id,client_id,total_amount,cuota,due_date,status,stage,dias_mora,product)
        VALUES (?,1,?,?,?,?,?,?,?,?)
      `, [i+1, clientId, total, cuota, dueDate, status, stage, diasMora,
          ['Sofá 3 puestos','Comedor 6 sillas','Cama doble','Sala completa'][rnd(0,3)]]);
    }

    // ── Sample promise ───────────────────────────────────────
    await conn.query(`
      INSERT IGNORE INTO promises
        (id,tenant_id,credit_id,client_id,promised_date,promised_amount,confidence,status,source)
      VALUES (1,1,5,3,?,120000,75,'pending','wa')
    `, [daysFromNow(2)]);

    // ── Sample comm_log entries ──────────────────────────────
    const entries = [
      [1,3,5,'wa','out','Hola María, recuerda que tu cuota vence en 3 días. Monto: $120,000','delivered'],
      [2,5,null,'call','out','Llamada IA realizada – cliente acordó pagar viernes','completed'],
      [3,1,1,'wa','in','Buenas, ya hice la transferencia por Nequi','read'],
    ];
    for (const [id,clientId,creditId,channel,dir,msg,status] of entries) {
      await conn.query(`
        INSERT IGNORE INTO comm_log (id,tenant_id,client_id,credit_id,channel,direction,message,status)
        VALUES (?,1,?,?,?,?,?,?)
      `, [id, clientId, creditId, channel, dir, msg, status]);
    }

    console.log('✅  Seed complete — Real Confort MD ready');
    console.log('    Login: admin@realconfort.co / cobra2024');
  } finally {
    conn.release();
    process.exit(0);
  }
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
