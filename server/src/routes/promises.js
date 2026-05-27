/**
 * Promise-to-Pay Engine routes
 */
const express  = require('express');
const { pool } = require('../db/connection');
const auth     = require('../middleware/auth');
const router   = express.Router();

// GET /api/promises  — list (filter: status=pending|broken|kept)
router.get('/', auth, async (req, res) => {
  const { status, creditId } = req.query;
  let where  = 'p.tenant_id = ?';
  const params = [req.user.tenantId];
  if (status)   { where += ' AND p.status = ?';    params.push(status); }
  if (creditId) { where += ' AND p.credit_id = ?'; params.push(creditId); }

  const [rows] = await pool.query(`
    SELECT p.*, c.name client_name, c.phone, cr.cuota, cr.product
    FROM promises p
    JOIN clients c  ON c.id = p.client_id
    JOIN credits cr ON cr.id = p.credit_id
    WHERE ${where}
    ORDER BY p.promised_date ASC
  `, params);
  res.json(rows);
});

// POST /api/promises  — record a new promise
router.post('/', auth, async (req, res) => {
  try {
    const { creditId, clientId, promisedDate, promisedAmount, confidence, source, notes } = req.body;
    if (!creditId || !clientId || !promisedDate || !promisedAmount) {
      return res.status(400).json({ error: 'creditId, clientId, promisedDate, promisedAmount required' });
    }

    const [result] = await pool.query(`
      INSERT INTO promises (tenant_id, credit_id, client_id, collector_id, promised_date, promised_amount, confidence, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [req.user.tenantId, creditId, clientId, req.user.userId, promisedDate, promisedAmount,
        confidence || 70, source || 'manual', notes]);

    // Log risk event — promise made = slight positive signal
    await pool.query(
      'INSERT INTO risk_events (client_id, event_type, delta, note) VALUES (?, ?, ?, ?)',
      [clientId, 'promise_made', -5, `Promise for ${promisedDate}`]
    );

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/promises/:id  — mark kept / broken / partial
router.patch('/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['kept','broken','partial'].includes(status)) {
      return res.status(400).json({ error: 'status must be kept|broken|partial' });
    }

    const [[promise]] = await pool.query(
      'SELECT * FROM promises WHERE id = ? AND tenant_id = ?',
      [req.params.id, req.user.tenantId]
    );
    if (!promise) return res.status(404).json({ error: 'Not found' });

    await pool.query(
      'UPDATE promises SET status = ?, resolved_at = NOW() WHERE id = ?',
      [status, req.params.id]
    );

    // Update client risk score
    let delta = 0;
    let eventType = '';
    if (status === 'broken')  { delta = +15; eventType = 'promise_broken'; }
    if (status === 'kept')    { delta = -10; eventType = 'promise_kept'; }
    if (status === 'partial') { delta = +5;  eventType = 'promise_partial'; }

    if (delta !== 0) {
      await pool.query(
        'UPDATE clients SET risk_score = LEAST(100, GREATEST(0, risk_score + ?)) WHERE id = ?',
        [delta, promise.client_id]
      );
      await pool.query(
        'INSERT INTO risk_events (client_id, event_type, delta, note) VALUES (?, ?, ?, ?)',
        [promise.client_id, eventType, delta, `Promise ID ${req.params.id}`]
      );
    }

    // If broken → escalate credit stage
    if (status === 'broken') {
      await pool.query(
        'UPDATE credits SET stage = LEAST(4, stage + 1) WHERE id = ?',
        [promise.credit_id]
      );
    }

    res.json({ ok: true, riskDelta: delta });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
