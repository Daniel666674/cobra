/**
 * Ley 2300 de 2023 – Colombian debt collection compliance guard
 *
 * Enforces:
 *  - Contact hours: 7 AM – 8 PM (Colombia, UTC-5)
 *  - Max 2 contacts per client per day per channel
 *  - Opt-out: never contact if client.opt_out = 1
 */
const { pool } = require('../db/connection');

const HOUR_START = parseInt(process.env.CONTACT_HOUR_START) || 7;
const HOUR_END   = parseInt(process.env.CONTACT_HOUR_END)   || 20;
const MAX_DAILY  = parseInt(process.env.MAX_DAILY_CONTACTS)  || 2;

/**
 * Check if it's currently within legal contact hours (Colombia UTC-5)
 */
function isAllowedHour() {
  const now = new Date();
  // Colombia is UTC-5
  const colHour = (now.getUTCHours() - 5 + 24) % 24;
  return colHour >= HOUR_START && colHour < HOUR_END;
}

/**
 * Check if a client can be contacted today on a given channel
 * @param {number} clientId
 * @param {string} channel  – 'wa' | 'call' | 'sms'
 * @returns {{ allowed: boolean, reason?: string }}
 */
async function canContact(clientId, channel = 'wa') {
  if (!isAllowedHour()) {
    return {
      allowed: false,
      reason: `Outside legal hours. Contact allowed ${HOUR_START}:00–${HOUR_END}:00 COT (Ley 2300).`,
    };
  }

  const [rows] = await pool.query(`
    SELECT COUNT(*) AS cnt FROM comm_log
    WHERE client_id = ?
      AND channel   = ?
      AND direction = 'out'
      AND DATE(sent_at) = CURDATE()
  `, [clientId, channel]);

  if (rows[0].cnt >= MAX_DAILY) {
    return {
      allowed: false,
      reason: `Daily limit reached (${MAX_DAILY} contacts/channel/day per Ley 2300).`,
    };
  }

  return { allowed: true };
}

/**
 * Express middleware — blocks outbound contact routes if compliance fails
 * Expects req.body.clientId and req.body.channel
 */
async function complianceGuard(req, res, next) {
  const clientId = req.body.clientId || req.params.clientId;
  const channel  = req.body.channel  || 'wa';

  if (!clientId) return next();

  // Check opt-out
  const [rows] = await pool.query('SELECT opt_out FROM clients WHERE id = ?', [clientId]);
  if (rows[0]?.opt_out) {
    return res.status(403).json({ error: 'Client has opted out of communications.' });
  }

  const check = await canContact(Number(clientId), channel);
  if (!check.allowed) {
    return res.status(429).json({ error: check.reason });
  }

  next();
}

module.exports = { complianceGuard, canContact, isAllowedHour };
