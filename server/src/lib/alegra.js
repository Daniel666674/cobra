/**
 * Alegra Electronic Invoicing (Factura Electrónica DIAN) adapter
 * ─ If ALEGRA_USER + ALEGRA_TOKEN set → real Alegra API
 * ─ If blank                         → mock mode
 */
const isMock = !(process.env.ALEGRA_USER && process.env.ALEGRA_TOKEN);

if (isMock) {
  console.log('🧾  Alegra: MOCK mode (no ALEGRA credentials set)');
}

function b64Auth() {
  return Buffer.from(`${process.env.ALEGRA_USER}:${process.env.ALEGRA_TOKEN}`).toString('base64');
}

function fakeCUFE() {
  const chars = '0123456789abcdef';
  return Array.from({ length: 96 }, () => chars[Math.floor(Math.random() * 16)]).join('');
}

/**
 * Generate an electronic invoice (Factura Electrónica) via Alegra
 * After DIAN validation, Alegra returns a CUFE code and sends PDF to client.
 *
 * @param {object} opts
 * @param {string} opts.clientName
 * @param {string} opts.clientCedula
 * @param {string} opts.clientEmail
 * @param {number} opts.amount        – COP
 * @param {string} opts.description   – line item description
 * @param {string} opts.creditRef     – your internal credit ID
 * @returns {{ invoiceId, cufe, pdfUrl, mock }}
 */
async function createInvoice({ clientName, clientCedula, clientEmail, amount, description, creditRef }) {
  if (isMock) {
    const invoiceNum = Math.floor(Math.random() * 900) + 1200;
    const cufe = fakeCUFE();
    console.log(`\n[ALEGRA MOCK] FE generated`);
    console.log(`  Client  : ${clientName}  |  $${amount.toLocaleString('es-CO')}`);
    console.log(`  Invoice : FE-${invoiceNum}`);
    console.log(`  CUFE    : ${cufe.slice(0, 24)}…`);
    console.log(`  Status  : DIAN validated (mock)`);
    return {
      invoiceId: `FE-${invoiceNum}`,
      cufe,
      pdfUrl: `https://app.alegra.com/invoice/FE-${invoiceNum}.pdf`,
      status: 'validated',
      mock: true,
    };
  }

  // Alegra REST API
  const payload = {
    date: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    client: {
      name:            clientName,
      identification:  clientCedula,
      email:           clientEmail,
      identificationObject: { type: 'CC', number: clientCedula },
    },
    items: [{
      description,
      quantity:   1,
      price:      amount,
      tax:        [],
    }],
    stamp: { generateStamp: true },    // triggers DIAN FE flow
    observations: `Ref crédito: ${creditRef}`,
  };

  const res = await fetch('https://app.alegra.com/api/v1/invoices', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${b64Auth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Alegra error: ${res.status} ${await res.text()}`);
  const data = await res.json();

  return {
    invoiceId: `FE-${data.numberTemplate?.number}`,
    cufe:      data.stamp?.cufe || null,
    pdfUrl:    data.pdf || null,
    status:    data.stamp?.status || 'pending',
    mock: false,
  };
}

module.exports = { createInvoice, isMock };
