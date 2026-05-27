/**
 * Dapta AI Voice adapter
 * ─ If DAPTA_API_KEY is set → real Dapta calls
 * ─ If blank              → mock mode
 */
const isMock = !process.env.DAPTA_API_KEY;

if (isMock) {
  console.log('📞  Dapta: MOCK mode (no DAPTA_API_KEY set)');
}

/**
 * Trigger an AI collection call
 * @param {object} opts
 * @param {string} opts.phone      – +57…
 * @param {string} opts.nombre     – client name
 * @param {number} opts.cuota      – amount due
 * @param {number} opts.diasMora   – days overdue
 * @param {string} opts.payLink    – Bold payment link
 * @returns {{ callId, mock }}
 */
async function triggerCall({ phone, nombre, cuota, diasMora, payLink }) {
  if (isMock) {
    const callId = `MOCK_CALL_${Date.now()}`;
    console.log(`\n[DAPTA MOCK] AI call → ${phone}`);
    console.log(`  Client  : ${nombre}`);
    console.log(`  Cuota   : $${cuota.toLocaleString('es-CO')}`);
    console.log(`  Mora    : ${diasMora} días`);
    console.log(`  CallID  : ${callId}`);
    return { callId, mock: true, status: 'queued' };
  }

  const res = await fetch('https://api.dapta.ai/v1/calls', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.DAPTA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id:   process.env.DAPTA_AGENT_ID,
      phone_number: phone,
      variables: {
        nombre,
        monto:    cuota.toLocaleString('es-CO'),
        dias_mora: String(diasMora),
        link_pago: payLink,
      },
    }),
  });

  if (!res.ok) throw new Error(`Dapta error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { callId: data.call_id, mock: false, status: data.status };
}

/**
 * Get call status / recording summary
 */
async function getCallStatus(callId) {
  if (isMock) {
    const outcomes = ['no_answer','promise_made','paid','callback_requested'];
    return {
      callId,
      status:  'completed',
      outcome: outcomes[Math.floor(Math.random() * outcomes.length)],
      summary: 'Cliente acordó pagar el viernes.',
      duration: Math.floor(Math.random() * 180) + 30,
      mock: true,
    };
  }

  const res = await fetch(`https://api.dapta.ai/v1/calls/${callId}`, {
    headers: { 'Authorization': `Bearer ${process.env.DAPTA_API_KEY}` },
  });
  const data = await res.json();
  return { callId, ...data, mock: false };
}

module.exports = { triggerCall, getCallStatus, isMock };
