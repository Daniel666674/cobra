/**
 * WhatsApp Business API adapter
 * ─ If WA_TOKEN is set → real Meta Cloud API calls
 * ─ If blank           → mock mode (logs, never sends)
 */
const isMock = !process.env.WA_TOKEN;

if (isMock) {
  console.log('📱  WhatsApp: MOCK mode (no WA_TOKEN set)');
}

/**
 * Send a text message via WhatsApp
 * @param {string} to    – phone number with country code (+573001234567)
 * @param {string} body  – message text
 * @param {object} meta  – extra data for logging (credit_id, etc.)
 * @returns {object}     – { messageId, mock }
 */
async function sendText(to, body, meta = {}) {
  if (isMock) {
    const messageId = `MOCK_${Date.now()}`;
    console.log(`\n[WA MOCK] → ${to}`);
    console.log(`  "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`);
    if (meta.creditId) console.log(`  credit_id=${meta.creditId}`);
    return { messageId, mock: true };
  }

  const res = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WA_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`WA API error: ${JSON.stringify(err)}`);
  }

  const data = await res.json();
  return { messageId: data.messages?.[0]?.id, mock: false };
}

/**
 * Send a payment link button message
 */
async function sendPaymentLink(to, { nombre, cuota, link, dueDate }) {
  const body =
    `Hola ${nombre} 👋\n\n` +
    `Tu cuota de *${formatCOP(cuota)}* vence el *${dueDate}*.\n\n` +
    `Paga fácil con Nequi, Daviplata o tarjeta:\n🔗 ${link}\n\n` +
    `_Cobra · Real Confort MD_`;
  return sendText(to, body, { type: 'payment_link' });
}

/**
 * Send a D-3 preventive reminder
 */
async function sendReminder(to, { nombre, cuota, diasFalta, link }) {
  const body =
    `Hola ${nombre} ✅\n\n` +
    `Solo un recordatorio: tu cuota de *${formatCOP(cuota)}* ` +
    `vence en *${diasFalta} día${diasFalta !== 1 ? 's' : ''}*.\n\n` +
    `Págala ahora y evita intereses:\n🔗 ${link}`;
  return sendText(to, body, { type: 'reminder' });
}

/**
 * Send an overdue (mora) notice
 */
async function sendMoraNotice(to, { nombre, cuota, diasMora, link }) {
  const body =
    `Hola ${nombre} ⚠️\n\n` +
    `Tu cuota de *${formatCOP(cuota)}* lleva *${diasMora} día${diasMora !== 1 ? 's' : ''}* ` +
    `vencida.\n\n` +
    `Regulariza tu estado ahora:\n🔗 ${link}\n\n` +
    `Si tienes alguna dificultad, responde aquí y buscamos una solución.`;
  return sendText(to, body, { type: 'mora_notice' });
}

function formatCOP(n) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

module.exports = { sendText, sendPaymentLink, sendReminder, sendMoraNotice, isMock };
