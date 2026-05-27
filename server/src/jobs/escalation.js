/**
 * Escalation Engine — runs daily at 6:00 AM COT
 *
 * Stage logic:
 *   stage 0 → 1  : D-3  send preventive WA reminder
 *   stage 1 → 2  : D0   send mora notice WA
 *   stage 2 → 3  : D+4  trigger Dapta AI call
 *   stage 3 → 4  : D+10 flag for human collector + legal warning
 *
 * Also:
 *   - Updates dias_mora for all active credits
 *   - Detects broken promises
 *   - Adjusts risk scores
 */
const cron   = require('node-cron');
const { pool } = require('../db/connection');
const wa       = require('../lib/whatsapp');
const dapta   = require('../lib/dapta');
const bold    = require('../lib/bold');

let running = false;

async function runEscalation() {
  if (running) return;
  running = true;
  console.log(`\n⚡ [${new Date().toISOString()}] Escalation engine starting…`);

  try {
    // ── 1. Update dias_mora for all active credits ────────────────────────
    await pool.query(`
      UPDATE credits
      SET dias_mora = DATEDIFF(CURDATE(), due_date),
          status = CASE
            WHEN DATEDIFF(CURDATE(), due_date) > 0  THEN 'mora'
            WHEN DATEDIFF(due_date, CURDATE()) <= 5 THEN 'porvencer'
            ELSE status
          END
      WHERE status NOT IN ('pagado')
    `);
    console.log('  ✓ dias_mora updated');

    // ── 2. Stage 0 → 1: D-3 preventive reminder ──────────────────────────
    const [d3Credits] = await pool.query(`
      SELECT cr.*, cl.name client_name, cl.phone, cl.opt_out
      FROM credits cr JOIN clients cl ON cl.id = cr.client_id
      WHERE cr.status = 'porvencer'
        AND DATEDIFF(cr.due_date, CURDATE()) = 3
        AND cr.stage = 0
        AND cl.opt_out = 0
    `);

    for (const credit of d3Credits) {
      try {
        const payLink = await bold.createPaymentLink({
          creditId:    credit.id,
          clientName:  credit.client_name,
          amount:      credit.cuota,
          description: `Cuota ${credit.product || 'crédito'}`,
          orderId:     `COBRA-${credit.id}-D3-${Date.now()}`,
        });

        const result = await wa.sendReminder(credit.phone, {
          nombre:    credit.client_name,
          cuota:     credit.cuota,
          diasFalta: 3,
          link:      payLink.url,
        });

        await pool.query("UPDATE credits SET stage=1 WHERE id=?", [credit.id]);
        await logComm(credit, 'wa', `Recordatorio D-3 cuota $${credit.cuota}`, result.messageId);
        console.log(`  ✓ D-3 WA → ${credit.client_name} (credit ${credit.id})`);
      } catch (e) {
        console.error(`  ✗ D-3 failed for credit ${credit.id}:`, e.message);
      }
    }

    // ── 3. Stage 1 → 2: D0 mora notice ───────────────────────────────────
    const [d0Credits] = await pool.query(`
      SELECT cr.*, cl.name client_name, cl.phone, cl.opt_out
      FROM credits cr JOIN clients cl ON cl.id = cr.client_id
      WHERE cr.status = 'mora'
        AND cr.dias_mora BETWEEN 1 AND 3
        AND cr.stage = 1
        AND cl.opt_out = 0
    `);

    for (const credit of d0Credits) {
      try {
        const payLink = await bold.createPaymentLink({
          creditId:    credit.id,
          clientName:  credit.client_name,
          amount:      credit.cuota,
          description: `Cuota vencida ${credit.product || ''}`,
          orderId:     `COBRA-${credit.id}-MORA-${Date.now()}`,
        });

        const result = await wa.sendMoraNotice(credit.phone, {
          nombre:   credit.client_name,
          cuota:    credit.cuota,
          diasMora: credit.dias_mora,
          link:     payLink.url,
        });

        await pool.query("UPDATE credits SET stage=2 WHERE id=?", [credit.id]);
        await logComm(credit, 'wa', `Aviso mora ${credit.dias_mora} días`, result.messageId);
        console.log(`  ✓ Mora WA → ${credit.client_name} (credit ${credit.id}, ${credit.dias_mora}d)`);
      } catch (e) {
        console.error(`  ✗ Mora WA failed for credit ${credit.id}:`, e.message);
      }
    }

    // ── 4. Stage 2 → 3: D+4 AI call ──────────────────────────────────────
    const [aiCallCredits] = await pool.query(`
      SELECT cr.*, cl.name client_name, cl.phone, cl.opt_out
      FROM credits cr JOIN clients cl ON cl.id = cr.client_id
      WHERE cr.status = 'mora'
        AND cr.dias_mora >= 4
        AND cr.stage = 2
        AND cl.opt_out = 0
    `);

    for (const credit of aiCallCredits) {
      try {
        const payLink = await bold.createPaymentLink({
          creditId:    credit.id,
          clientName:  credit.client_name,
          amount:      credit.cuota,
          description: `Cuota urgente ${credit.product || ''}`,
          orderId:     `COBRA-${credit.id}-CALL-${Date.now()}`,
        });

        const result = await dapta.triggerCall({
          phone:    credit.phone,
          nombre:   credit.client_name,
          cuota:    credit.cuota,
          diasMora: credit.dias_mora,
          payLink:  payLink.url,
        });

        await pool.query("UPDATE credits SET stage=3 WHERE id=?", [credit.id]);
        await logComm(credit, 'call', `Llamada IA D+${credit.dias_mora}`, null, result.callId);
        console.log(`  ✓ AI call → ${credit.client_name} (credit ${credit.id}, ${credit.dias_mora}d)`);
      } catch (e) {
        console.error(`  ✗ AI call failed for credit ${credit.id}:`, e.message);
      }
    }

    // ── 5. Stage 3 → 4: D+10 critical — flag for human ───────────────────
    const [criticalCredits] = await pool.query(`
      SELECT cr.*, cl.name client_name FROM credits cr
      JOIN clients cl ON cl.id = cr.client_id
      WHERE cr.status = 'mora' AND cr.dias_mora >= 10 AND cr.stage = 3
    `);

    for (const credit of criticalCredits) {
      await pool.query("UPDATE credits SET stage=4 WHERE id=?", [credit.id]);
      await pool.query(
        'UPDATE clients SET risk_score = LEAST(100, risk_score + 10) WHERE id = ?',
        [credit.client_id]
      );
      console.log(`  ⚠️  CRITICAL: ${credit.client_name} credit ${credit.id} → stage 4 (human needed)`);
    }

    // ── 6. Detect broken promises ─────────────────────────────────────────
    const [brokenPromises] = await pool.query(`
      SELECT p.*, c.risk_score FROM promises p
      JOIN clients c ON c.id = p.client_id
      WHERE p.status = 'pending' AND p.promised_date < CURDATE()
    `);

    for (const promise of brokenPromises) {
      await pool.query(
        "UPDATE promises SET status='broken', resolved_at=NOW() WHERE id=?",
        [promise.id]
      );
      await pool.query(
        'UPDATE clients SET risk_score = LEAST(100, risk_score + 15) WHERE id = ?',
        [promise.client_id]
      );
      await pool.query(
        'INSERT INTO risk_events (client_id, event_type, delta, note) VALUES (?, ?, ?, ?)',
        [promise.client_id, 'promise_broken', 15, `Missed promised date ${promise.promised_date}`]
      );
      console.log(`  💔 Broken promise: client ${promise.client_id} was due ${promise.promised_date}`);
    }

    console.log(`✅  Escalation complete\n`);
  } catch (err) {
    console.error('❌  Escalation engine error:', err);
  } finally {
    running = false;
  }
}

async function logComm(credit, channel, message, waMsgId = null, callId = null) {
  await pool.query(`
    INSERT INTO comm_log (tenant_id, client_id, credit_id, channel, direction, message, status, wa_msg_id, dapta_call_id)
    VALUES (?, ?, ?, ?, 'out', ?, 'sent', ?, ?)
  `, [credit.tenant_id, credit.client_id, credit.id, channel, message, waMsgId, callId]);
}

// Schedule: every day at 6:00 AM COT (11:00 UTC)
function start() {
  cron.schedule('0 11 * * *', runEscalation, { timezone: 'UTC' });
  console.log('⚡  Escalation engine scheduled (daily 6AM COT)');
}

// Allow manual trigger for testing
module.exports = { start, runEscalation };
