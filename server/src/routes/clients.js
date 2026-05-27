const express  = require('express');
const { pool } = require('../db/connection');
const auth     = require('../middleware/auth');
const router   = express.Router();

// GET /api/clients
router.get('/', auth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM clients WHERE tenant_id = ? ORDER BY name',
    [req.user.tenantId]
  );
  res.json(rows);
});

// GET /api/clients/:id  — with credit summary
router.get('/:id', auth, async (req, res) => {
  const [[client]] = await pool.query(
    'SELECT * FROM clients WHERE id = ? AND tenant_id = ?',
    [req.params.id, req.user.tenantId]
  );
  if (!client) return res.status(404).json({ error: 'Not found' });

  const [credits]  = await pool.query('SELECT * FROM credits WHERE client_id = ?', [req.params.id]);
  const [promises] = await pool.query('SELECT * FROM promises WHERE client_id = ? ORDER BY created_at DESC LIMIT 5', [req.params.id]);
  const [commLog]  = await pool.query('SELECT * FROM comm_log WHERE client_id = ? ORDER BY sent_at DESC LIMIT 20', [req.params.id]);

  res.json({ ...client, credits, promises, commLog });
});

// POST /api/clients
router.post('/', auth, async (req, res) => {
  try {
    const { name, phone, cedula, email, address, incomeDay } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const [result] = await pool.query(`
      INSERT INTO clients (tenant_id, name, phone, cedula, email, address, income_day)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [req.user.tenantId, name, phone, cedula, email, address, incomeDay]);

    res.status(201).json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/clients/:id
router.patch('/:id', auth, async (req, res) => {
  const allowed = ['name','phone','email','address','risk_score','pref_channel','pref_hour','income_day','opt_out','notes'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  const sets   = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => req.body[f]);
  await pool.query(
    `UPDATE clients SET ${sets} WHERE id = ? AND tenant_id = ?`,
    [...values, req.params.id, req.user.tenantId]
  );
  res.json({ ok: true });
});

module.exports = router;
