const crypto = require('crypto');
const RECIPIENTS = [
  'radhikaagenciesddun@gmail.com',
  'radhikaagenciesuk@gmail.com',
  'vrm.vrm777@gmail.com',
];
function orderItems(input, stock) {
  if (!Array.isArray(input) || !input.length || input.length > 5000)
    throw new Error('Select at least one medicine.');
  const quantities = new Map();
  for (const row of input) {
    const code = String(row.code || '').trim(),
      quantity = Number(row.quantity);
    if (!code || code.length > 100 || !Number.isSafeInteger(quantity) || quantity <= 0)
      throw new Error('Each medicine needs a valid drug code and whole quantity.');
    quantities.set(code, (quantities.get(code) || 0) + quantity);
  }
  const available = new Map();
  for (const row of stock)
    available.set(
      String(row.code),
      (available.get(String(row.code)) || 0) + (Number(row.available) || 0)
    );
  const items = [...quantities].map(([code, quantity]) => ({ code, quantity }));
  for (const r of items)
    if (!available.has(r.code) || r.quantity > available.get(r.code))
      throw new Error(
        `Stock changed for drug code ${r.code}. Refresh the stock page and check the quantity.`
      );
  return items;
}
function unavailableItems(input) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 5000)
    throw Error('Invalid unavailable medicine list.');
  return input.map((row) => {
    const code = String(row.code || '').trim();
    const quantity = Number(row.quantity),
      requestedQuantity = Number(row.requestedQuantity),
      availableQuantity = Number(row.availableQuantity);
    if (
      !code ||
      code.length > 100 ||
      ![quantity, requestedQuantity, availableQuantity].every(Number.isSafeInteger) ||
      quantity <= 0 ||
      availableQuantity < 0 ||
      requestedQuantity !== quantity + availableQuantity
    )
      throw Error('Invalid unavailable medicine quantity.');
    return { code, quantity, requestedQuantity, availableQuantity };
  });
}
function mailContent(id, items, contact = {}) {
  const cell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const csv =
    '\uFEFF' +
    [['Drug Code', 'Quantity'], ...items.map((r) => [r.code, r.quantity])]
      .map((row) => row.map(cell).join(','))
      .join('\r\n');
  return {
    subject:
      'Stock request from Website (' +
      (contact.storeCode || '') +
      ') - ' +
      new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date()) +
      ' IST',
    text:
      'New stock request from the Radhika Agencies website.\nRequest: ' +
      id +
      '\nStore Code: ' +
      (contact.storeCode || '') +
      '\nMobile No.: ' +
      (contact.mobile || '') +
      '\n\nPlease find the order list in the attached CSV.\n\nPlease confirm availability and contact the requester through your usual process.',
    attachments: [
      { filename: 'stock-request-' + id + '.csv', content: csv, contentType: 'text/csv' },
    ],
  };
}
function payloadHash(input) {
  const items = Array.isArray(input) ? input : input.items;
  const contact = Array.isArray(input)
    ? {}
    : {
        ...(input.unavailableItems?.length ? { unavailableItems: input.unavailableItems } : {}),
        storeCode: input.storeCode,
        mobile: input.mobile,
        ...(input.allocations
          ? { allocations: input.allocations, stockVersion: input.stockVersion }
          : {}),
      };
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({ items: [...items].sort((a, b) => a.code.localeCompare(b.code)), ...contact })
    )
    .digest('hex');
}
module.exports = { RECIPIENTS, orderItems, unavailableItems, mailContent, payloadHash };
