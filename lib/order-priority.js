const { dateKey } = require('./order-insights');
function rankOrders(rows, now = new Date()) {
  const today = dateKey(now), monday = new Date(today + 'T00:00:00Z');
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const starts = { weekly: monday.toISOString().slice(0, 10), monthly: today.slice(0, 7) + '-01', yearly: today.slice(0, 4) + '-01-01' };
  const groups = Object.fromEntries(Object.keys(starts).map(k => [k, new Map()]));
  for (const row of rows) {
    if (String(row.status || '').toLowerCase() === 'cancelled') continue;
    let order;
    try { order = JSON.parse(row.payload); } catch { continue; }
    const code = String(order?.storeCode || '').trim().replace(/^(pmbjk|pmjbk|pmbi)[\s_-]*/i, '').trim().toUpperCase();
    if (!code || !row.created_at || Number.isNaN(new Date(row.created_at).getTime())) continue;
    const date = dateKey(row.created_at);
    for (const key of Object.keys(starts)) if (date >= starts[key] && date <= today) groups[key].set(code, (groups[key].get(code) || 0) + 1);
  }
  return { today, starts, rankings: Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, [...group].map(([storeCode, orders]) => ({ storeCode, orders })).sort((a,b) => b.orders - a.orders || a.storeCode.localeCompare(b.storeCode, 'en', { numeric: true }))])) };
}
module.exports = { rankOrders };
