// PrintNode (https://www.printnode.com): sends label PDFs to the Windows PC the Clabel CT221B is plugged into.
const KEY = () => process.env.PRINTNODE_API_KEY || '';
const configured = () => !!KEY();

async function call(method, path, payload) {
  if (!configured()) throw new Error('PrintNode is not set up yet (missing API key).');
  const r = await fetch('https://api.printnode.com' + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(KEY() + ':').toString('base64'),
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error('PrintNode: ' + (data?.message || `HTTP ${r.status}`));
  return data;
}

async function printPdf({ printerId, title, pdf, copies = 1 }) {
  return call('POST', '/printjobs', {
    printerId: Number(printerId),
    title,
    contentType: 'pdf_base64',
    content: Buffer.from(pdf).toString('base64'),
    source: "Ali's Fresh Meats online orders",
    options: { copies: Math.max(1, Number(copies) || 1) },
  }); // returns the print job id
}

async function printers() {
  const list = await call('GET', '/printers');
  return (list || []).map((p) => ({ id: p.id, name: p.name, computer: p.computer?.name || '', state: p.state }));
}

module.exports = { configured, printPdf, printers };
