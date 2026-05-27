/**
 * Payments — process confirmed payments, generate FE via Alegra
 */
const express  = require('express');
const { pool } = require('../db/connection');
const auth     = require('../middleware/auth');
const alegra   = require('../lib/alegra');
const bold     = require('../lib/bold');
const router   = express.Router();

// POST /api/payments  — record a manual payment (cash, transfer)
router.post('/', auth, async (req, res) => {
  try {
    const { creditId, amount, method, notes } = req.body;
    if (!creditId || !amount || !method) {
      return res.status(400).json({ error: 'creditId, amount, method required' });
    }
    await processPayment({ creditId, amount, method, notes, tenantId: req.user.tenantId });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/webhook/bold  — Bold/Wompi confirmation webhook
router.post('/webhook/bold', async (req, res) => {
  try {
    const sig = req.headers['x-bold-signature'] || '';
    const rawBody = JSON.stringify(req.body);

    if (!bold.verifyWebhook(rawBody, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { order_id, status, amount, payment_method } = req.body;
    if (status !== 'APPROVED') return res.json({ received: true });

    // order_id format: COBRA-{creditId}-{timestamp}
    const creditId = parseInt(order_id.split('-')[1]);
    if (!creditId) return res.status(400).json({ error: 'Bad order_id' });

    const [[credit]] = await pool.query('SELECT * FROM credits WHERE id = ?', [creditId]);
    if (!credit) return res.status(404).json({ error: 'Credit not found' });

    await processPayment({
      creditId,
      amount,
      method: payment_method?.toLowerCase() || 'card',
      tenantId: credit.tenant_id,
    });

    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// GET /api/payments  — list payments for tenant
router.get('/', auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT p.*, c.name client_name, cr.product
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    JOIN credits cr ON cr.id = p.credit_id
    WHERE p.tenant_id = ?
    ORDER BY p.paid_at DESC
    LIMIT 100
  `, [req.user.tenantId]);
  res.json(rows);
});

// ── Internal helper ───────────────────────────────────────────────────────────
async function processPayment({ creditId, amount, method, notes, tenantId }) {
  const [[credit]] = await pool.query(`
    SELECT cr.*, cl.name client_name, cl.cedula, cl.email client_email
    FROM credits cr JOIN clients cl ON cl.id = cr.client_id
    WHERE cr.id = ?
  `, [creditId]);

  if (!credit) throw new Error('Credit not found');

  // Generate Alegra FE
  let invoiceId, cufe, pdfUrl;
  try {
    const fe = await alegra.createInvoice({
      clientName:  credit.client_name,
      clientCedula: credit.cedula,
      clientEmail:  credit.client_email,
      amount,
      description: `Cuota ${credit.product || 'crédito'} – venc. ${credit.due_date}`,
      creditRef:   `COBRA-${creditId}`,
    });
    invoiceId = fe.invoiceId;
    cufe      = fe.cufe;
    pdfUrl    = fe.pdfUrl;
  } catch (e) {
    console.error('Alegra FE failed (non-fatal):', e.message);
  }

  // Record payment
  await pool.query(`
    INSERT INTO payments (tenant_id, credit_id, client_id, amount, method, alegra_inv_id, alegra_cufe, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [tenantId, creditId, credit.client_id, amount, method, invoiceId, cufe, notes]);

  // Mark credit paid
  await pool.query(
    "UPDATE credits SET status='pagado', stage=0, dias_mora=0, paid_at=NOW() WHERE id=?",
    [creditId]
  );

  // Update client risk score (paid = lower risk)
  await pool.query(
    'UPDATE clients SET risk_score = GREATEST(0, risk_score - 8) WHERE id = ?',
    [credit.client_id]
  );
  await pool.query(
    'INSERT INTO risk_events (client_id, event_type, delta, note) VALUES (?, ?, ?, ?)',
    [credit.client_id, 'payment_received', -8, `$${amount.toLocaleString()} via ${method}`]
  );

  // Mark any open promises as kept
  await pool.query(
    "UPDATE promises SET status='kept', resolved_at=NOW() WHERE credit_id=? AND status='pending'",
    [creditId]
  );

  console.log(`💰 Payment recorded: credit ${creditId} · $${amount} · ${method} · FE=${invoiceId}`);
  return { invoiceId, cufe, pdfUrl };
}

module.exports = router;
