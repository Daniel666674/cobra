const express  = require('express');
const { pool } = require('../db/connection');
const auth     = require('../middleware/auth');
const bold     = require('../lib/bold');
const router   = express.Router();

// GET /api/credits  — list all credits for tenant
router.get('/', auth, async (req, res) => {
  try {
    const { status, clientId, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    let where  = 'c.tenant_id = ?';
    const params = [req.user.tenantId];

    if (status)   { where += ' AND c.status = ?';    params.push(status); }
    if (clientId) { where += ' AND c.client_id = ?'; params.push(clientId); }

    const [rows] = await pool.query(`
      SELECT c.*, cl.name client_name, cl.phone, cl.risk_score
      FROM credits c
      JOIN clients cl ON cl.id = c.client_id
      WHERE ${where}
      ORDER BY c.dias_mora DESC, c.due_date ASC
      LIMIT ? OFFSET ?
    `, [...params, Number(limit), Number(offset)]);

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total FROM credits c WHERE ${where}`,
      params
    );

    res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/credits/:id
router.get('/:id', auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT c.*, cl.name client_name, cl.phone, cl.risk_score, cl.email client_email
    FROM credits c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.id = ? AND c.tenant_id = ?
  `, [req.params.id, req.user.tenantId]);
  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// POST /api/credits  — create new credit
router.post('/', auth, async (req, res) => {
  try {
    const { clientId, totalAmount, cuota, dueDate, product, description } = req.body;
    if (!clientId || !totalAmount || !cuota || !dueDate) {
      return res.status(400).json({ error: 'clientId, totalAmount, cuota, dueDate required' });
    }

    const [result] = await pool.query(`
      INSERT INTO credits (tenant_id, client_id, total_amount, cuota, due_date, product, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [req.user.tenantId, clientId, totalAmount, cuota, dueDate, product, description]);

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/credits/:id  — update status / stage
router.patch('/:id', auth, async (req, res) => {
  try {
    const allowed = ['status','stage','dias_mora','product','description'];
    const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

    const sets   = fields.map(f => `${f} = ?`).join(', ');
    const values = fields.map(f => req.body[f]);
    await pool.query(
      `UPDATE credits SET ${sets} WHERE id = ? AND tenant_id = ?`,
      [...values, req.params.id, req.user.tenantId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/credits/:id/payment-link  — generate Bold link
router.post('/:id/payment-link', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.*, cl.name client_name FROM credits c
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = ? AND c.tenant_id = ?
    `, [req.params.id, req.user.tenantId]);
    if (!rows[0]) return res.status(404).json({ error: 'Credit not found' });

    const credit = rows[0];
    const orderId = `COBRA-${credit.id}-${Date.now()}`;

    const link = await bold.createPaymentLink({
      creditId:    credit.id,
      clientName:  credit.client_name,
      amount:      credit.cuota,
      description: `Cuota ${credit.product || 'crédito'} – ${credit.client_name}`,
      orderId,
    });

    res.json(link);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
