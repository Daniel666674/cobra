const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { pool } = require('../db/connection');
const router   = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const [rows] = await pool.query(
      'SELECT u.*, t.slug tenant_slug, t.name tenant_name FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.email=? AND u.active=1',
      [email.toLowerCase().trim()]
    );

    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await pool.query('UPDATE users SET last_login=NOW() WHERE id=?', [user.id]);

    const token = jwt.sign(
      { userId: user.id, tenantId: user.tenant_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: {
        id:         user.id,
        name:       user.name,
        email:      user.email,
        role:       user.role,
        tenantSlug: user.tenant_slug,
        tenantName: user.tenant_name,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
const auth = require('../middleware/auth');
router.get('/me', auth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT u.id,u.name,u.email,u.role,t.name tenant_name,t.slug tenant_slug FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=?',
    [req.user.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

module.exports = router;
