/**
 * Dapta AI voice call routes
 */
const express  = require('express');
const { pool } = require('../db/connection');
const auth     = require('../middleware/auth');
const dapta    = require('../lib/dapta');
const bold     = require('../lib/bold');
const { isAllowedHour } = require('../middleware/compliance');
const router   = express.Router();

// POST /api/calls/trigger  — manually trigger an AI call
router.post('/trigger', auth, async (req, res) => {
  try {
    if (!isAllowedHour()) {
      return res.status(429).json({ error: 'Outside legal contact hours (7AM–8PM COT / Ley 2300)' });
    }

    const { creditId } = req.body;
    const [[credit]] = await pool.query(`
      SELECT cr.*, cl.name client_name, cl.phone FROM credits cr
      JOIN clients cl ON cl.id = cr.client_id
      WHERE cr.id = ? AND cr.tenant_id = ?
    `, [creditId, req.user.tenantId]);

    if (!credit) return res.status(404).json({ error: 'Credit not found' });

    // Get payment link
    const payLink = await bold.createPaymentLink({
      creditId:    credit.id,
      clientName:  credit.client_name,
      amount:      credit.cuota,
      description: `Cuota ${credit.product || 'crédito'}`,
      orderId:     `COBRA-${credit.id}-${Date.now()}`,
    });

    const result = await dapta.triggerCall({
      phone:    credit.phone,
      nombre:   credit.client_name,
      cuota:    credit.cuota,
      diasMora: credit.dias_mora,
      payLink:  payLink.url,
    });

    // Log the call
    await pool.query(`
      INSERT INTO comm_log (tenant_id, client_id, credit_id, channel, direction, message, status, dapta_call_id)
      VALUES (?, ?, ?, 'call', 'out', ?, 'queued', ?)
    `, [req.user.tenantId, credit.client_id, creditId,
        `Llamada IA Dapta · mora ${credit.dias_mora} días`, result.callId]);

    // Advance escalation stage
    await pool.query(
      'UPDATE credits SET stage = LEAST(4, stage + 1) WHERE id = ?',
      [creditId]
    );

    res.json({ ok: true, callId: result.callId, mock: result.mock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/calls  — list call log for tenant
router.get('/', auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT cl.*, c.name client_name, c.phone, cr.cuota, cr.dias_mora
    FROM comm_log cl
    JOIN clients c ON c.id = cl.client_id
    LEFT JOIN credits cr ON cr.id = cl.credit_id
    WHERE cl.tenant_id = ? AND cl.channel = 'call'
    ORDER BY cl.sent_at DESC LIMIT 100
  `, [req.user.tenantId]);
  res.json(rows);
});

// GET /api/calls/:callId/status  — Dapta call outcome
router.get('/:callId/status', auth, async (req, res) => {
  try {
    const status = await dapta.getCallStatus(req.params.callId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
