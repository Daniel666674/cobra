/**
 * WhatsApp routes + Meta webhook handler
 */
const express  = require('express');
const { pool } = require('../db/connection');
const auth     = require('../middleware/auth');
const wa       = require('../lib/whatsapp');
const { complianceGuard } = require('../middleware/compliance');
const router   = express.Router();

// GET /api/whatsapp/webhook  — Meta verification challenge
router.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('✅  WhatsApp webhook verified');
    return res.send(challenge);
  }
  res.sendStatus(403);
});

// POST /api/whatsapp/webhook  — incoming messages from Meta
router.post('/webhook', async (req, res) => {
  try {
    res.sendStatus(200); // acknowledge immediately

    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!entry?.messages) return;

    for (const msg of entry.messages) {
      const phone = msg.from;
      const text  = msg.text?.body || '';

      console.log(`[WA IN] ${phone}: "${text}"`);

      // Find client by phone
      const [clients] = await pool.query('SELECT * FROM clients WHERE phone = ? LIMIT 1', [phone]);
      if (!clients[0]) continue;

      const client = clients[0];

      // Log inbound message
      await pool.query(`
        INSERT INTO comm_log (tenant_id, client_id, channel, direction, message, status, wa_msg_id)
        VALUES (?, ?, 'wa', 'in', ?, 'received', ?)
      `, [client.tenant_id, client.id, text.slice(0, 500), msg.id]);

      // Basic intent detection
      const lower = text.toLowerCase();
      if (/pagu[eé]|ya pagu[eé]|transf[eé]r|consign/.test(lower)) {
        // Client claims they paid — flag for review
        await pool.query(
          'INSERT INTO risk_events (client_id, event_type, delta, note) VALUES (?, ?, ?, ?)',
          [client.id, 'payment_claimed', -3, `WA: "${text.slice(0, 80)}"`]
        );
      }
      if (/viernes|lunes|martes|miércoles|jueves|sábado|semana|quincena|quince/.test(lower)) {
        // Promise keyword detected — could trigger promise creation flow
        console.log(`[PROMISE DETECTED] Client ${client.id}: "${text}"`);
      }
      if (/no puedo|no tengo|sin plata|desemplea/.test(lower)) {
        // Hardship signal — bump risk slightly
        await pool.query(
          'UPDATE clients SET risk_score = LEAST(100, risk_score + 8) WHERE id = ?',
          [client.id]
        );
      }
    }
  } catch (err) {
    console.error('WA webhook error:', err.message);
  }
});

// POST /api/whatsapp/send/reminder  — manual trigger
router.post('/send/reminder', auth, complianceGuard, async (req, res) => {
  try {
    const { creditId } = req.body;
    const [[credit]] = await pool.query(`
      SELECT cr.*, cl.name client_name, cl.phone FROM credits cr
      JOIN clients cl ON cl.id = cr.client_id
      WHERE cr.id = ? AND cr.tenant_id = ?
    `, [creditId, req.user.tenantId]);

    if (!credit) return res.status(404).json({ error: 'Credit not found' });

    const link  = `https://pay.realconfort.co/${creditId}`;
    const diasFalta = Math.ceil((new Date(credit.due_date) - new Date()) / 86400000);

    const result = await wa.sendReminder(credit.phone, {
      nombre: credit.client_name,
      cuota:  credit.cuota,
      diasFalta: diasFalta > 0 ? diasFalta : 0,
      link,
    });

    // Log outbound
    await pool.query(`
      INSERT INTO comm_log (tenant_id, client_id, credit_id, channel, direction, message, status, wa_msg_id)
      VALUES (?, ?, ?, 'wa', 'out', ?, 'sent', ?)
    `, [req.user.tenantId, credit.client_id, creditId,
        `Recordatorio cuota $${credit.cuota} vence ${diasFalta} días`, result.messageId]);

    res.json({ ok: true, mock: result.mock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/whatsapp/history/:clientId
router.get('/history/:clientId', auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT * FROM comm_log
    WHERE client_id = ? AND tenant_id = ? AND channel = 'wa'
    ORDER BY sent_at DESC LIMIT 50
  `, [req.params.clientId, req.user.tenantId]);
  res.json(rows);
});

module.exports = router;
