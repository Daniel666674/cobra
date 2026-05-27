/**
 * Bold / Wompi payment link adapter
 * ─ If BOLD_SECRET_KEY is set → real links via Bold API
 * ─ If blank                 → mock mode (returns fake URLs)
 */
const crypto = require('crypto');
const isMock = !process.env.BOLD_SECRET_KEY;

if (isMock) {
  console.log('💳  Bold: MOCK mode (no BOLD_SECRET_KEY set)');
}

/**
 * Create a payment link for a credit cuota
 * @param {object} opts
 * @param {number} opts.creditId
 * @param {string} opts.clientName
 * @param {number} opts.amount       – COP, no decimals
 * @param {string} opts.description  – e.g. "Cuota Sofá 3 puestos"
 * @param {string} opts.orderId      – your unique reference
 * @returns {{ url, linkId, mock }}
 */
async function createPaymentLink({ creditId, clientName, amount, description, orderId }) {
  if (isMock) {
    const fakeId = `MOCK_LINK_${creditId}_${Date.now()}`;
    const fakeUrl = `https://pay.realconfort.co/pago/${creditId}`;
    console.log(`\n[BOLD MOCK] Payment link created`);
    console.log(`  Client : ${clientName}  |  Amount: $${amount.toLocaleString('es-CO')}`);
    console.log(`  URL    : ${fakeUrl}`);
    return { url: fakeUrl, linkId: fakeId, mock: true };
  }

  // Bold payment link API
  const payload = {
    amount: { currency: 'COP', total_amount: amount },
    description,
    order_id: orderId,
    redirect_url: `${process.env.APP_URL}/api/payments/confirm`,
  };

  // Bold integrity hash: SHA-256(orderId + amount + currency + secret)
  const raw = `${orderId}${amount}COP${process.env.BOLD_INTEGRITY_KEY}`;
  payload.integrity = crypto.createHash('sha256').update(raw).digest('hex');

  const res = await fetch('https://integrations.bold.co/payment/v2/link', {
    method: 'POST',
    headers: {
      'Authorization': `x-api-key ${process.env.BOLD_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Bold error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { url: data.payload?.url, linkId: data.payload?.payment_link_id, mock: false };
}

/**
 * Verify a Bold webhook signature
 */
function verifyWebhook(rawBody, signature) {
  if (isMock) return true;
  const expected = crypto
    .createHash('sha256')
    .update(rawBody + process.env.BOLD_INTEGRITY_KEY)
    .digest('hex');
  return expected === signature;
}

module.exports = { createPaymentLink, verifyWebhook, isMock };
