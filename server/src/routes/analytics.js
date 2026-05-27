/**
 * Recovery Analytics — dashboard KPIs and reports
 */
const express  = require('express');
const { pool } = require('../db/connection');
const auth     = require('../middleware/auth');
const router   = express.Router();

// GET /api/analytics/kpis  — main dashboard numbers
router.get('/kpis', auth, async (req, res) => {
  try {
    const tid = req.user.tenantId;

    const [[totals]] = await pool.query(`
      SELECT
        COUNT(*) total,
        SUM(status='mora') mora,
        SUM(status='porvencer') porvencer,
        SUM(status='vigente') vigente,
        SUM(status='pagado') pagado,
        SUM(CASE WHEN status='mora' THEN cuota ELSE 0 END) monto_mora,
        SUM(CASE WHEN status='porvencer' THEN cuota ELSE 0 END) monto_porvencer
      FROM credits WHERE tenant_id=?
    `, [tid]);

    const [[recaudo]] = await pool.query(`
      SELECT
        SUM(amount) total,
        SUM(CASE WHEN MONTH(paid_at)=MONTH(NOW()) AND YEAR(paid_at)=YEAR(NOW()) THEN amount ELSE 0 END) mes
      FROM payments WHERE tenant_id=?
    `, [tid]);

    const [[promises]] = await pool.query(`
      SELECT
        SUM(status='pending') pending,
        SUM(status='broken') broken,
        SUM(status='kept') kept
      FROM promises WHERE tenant_id=?
    `, [tid]);

    const [[waActivity]] = await pool.query(`
      SELECT COUNT(*) sent_today FROM comm_log
      WHERE tenant_id=? AND channel='wa' AND direction='out' AND DATE(sent_at)=CURDATE()
    `, [tid]);

    res.json({
      credits:  totals,
      recaudo:  recaudo,
      promises: promises,
      waToday:  waActivity.sent_today,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/analytics/aging  — mora aging breakdown
router.get('/aging', auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      SUM(dias_mora BETWEEN 1  AND 15) AS d1_15,
      SUM(dias_mora BETWEEN 16 AND 30) AS d16_30,
      SUM(dias_mora BETWEEN 31 AND 60) AS d31_60,
      SUM(dias_mora > 60)              AS d60plus,
      SUM(CASE WHEN dias_mora BETWEEN 1  AND 15 THEN cuota ELSE 0 END) val_1_15,
      SUM(CASE WHEN dias_mora BETWEEN 16 AND 30 THEN cuota ELSE 0 END) val_16_30,
      SUM(CASE WHEN dias_mora BETWEEN 31 AND 60 THEN cuota ELSE 0 END) val_31_60,
      SUM(CASE WHEN dias_mora > 60             THEN cuota ELSE 0 END) val_60plus
    FROM credits WHERE tenant_id = ? AND status = 'mora'
  `, [req.user.tenantId]);
  res.json(rows[0]);
});

// GET /api/analytics/recovery-trend  — weekly recaudo last 8 weeks
router.get('/recovery-trend', auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      YEARWEEK(paid_at, 1)  week,
      MIN(DATE(paid_at))    week_start,
      SUM(amount)           total,
      COUNT(*)              count
    FROM payments
    WHERE tenant_id = ? AND paid_at >= DATE_SUB(NOW(), INTERVAL 8 WEEK)
    GROUP BY YEARWEEK(paid_at, 1)
    ORDER BY week
  `, [req.user.tenantId]);
  res.json(rows);
});

// GET /api/analytics/risk-distribution
router.get('/risk-distribution', auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      SUM(risk_score < 40)                    low_risk,
      SUM(risk_score BETWEEN 40 AND 69)       medium_risk,
      SUM(risk_score >= 70)                   high_risk
    FROM clients WHERE tenant_id = ?
  `, [req.user.tenantId]);
  res.json(rows[0]);
});

module.exports = router;
