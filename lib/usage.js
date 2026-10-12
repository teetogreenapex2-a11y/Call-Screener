// Counts screened calls per month so one customer cannot run up your Twilio bill.
// Owner cap: OWNER_MONTHLY_CALLS (0 = no limit). Customers: CUSTOMER_MONTHLY_CALLS (default 500).
const store = require('./store');

const monthKey = (ns) => `${ns || ''}usage:${new Date().toISOString().slice(0, 7)}`;

function capFor(t) {
  const e = process.env;
  const v = t && t.id ? (e.CUSTOMER_MONTHLY_CALLS !== undefined ? e.CUSTOMER_MONTHLY_CALLS : '500') : (e.OWNER_MONTHLY_CALLS || '0');
  return Math.max(0, Number(v) || 0);
}

// Adds one call to this month's count. Never blocks a call because of a database error.
async function record(t) {
  const cap = capFor(t);
  const ns = t && t.id ? `u:${t.id}:` : '';
  try {
    const count = (Number(await store.get(monthKey(ns))) || 0) + 1;
    await store.set(monthKey(ns), count, 60 * 60 * 24 * 40);
    return { count, cap, over: cap > 0 && count > cap, justHit: cap > 0 && count === cap + 1 };
  } catch (err) {
    console.error('usage count failed:', err && err.message);
    return { count: 0, cap, over: false, justHit: false };
  }
}

async function current(t) {
  const ns = t && t.id ? `u:${t.id}:` : '';
  try {
    return { count: Number(await store.get(monthKey(ns))) || 0, cap: capFor(t) };
  } catch (_) {
    return { count: 0, cap: capFor(t) };
  }
}

module.exports = { record, current, capFor };
