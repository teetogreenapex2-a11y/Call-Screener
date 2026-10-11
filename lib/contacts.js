const store = require('./store');

const KEY = 'allowlist';

// Phone numbers are compared by their last 10 digits, so +1 (919) 555-1234 and 9195551234 match.
function norm(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

async function load() {
  const raw = await store.get(KEY);
  return new Set(String(raw || '').split(',').filter(Boolean));
}

async function save(set) {
  await store.set(KEY, [...set].join(','));
}

// True if this caller is on your always-ring-through list. Any error means "no", so the call is screened as usual.
async function isAllowed(from) {
  const n = norm(from);
  if (!n || !store.configured()) return false;
  try {
    return (await load()).has(n);
  } catch (err) {
    console.error('contacts read failed:', err && err.message);
    return false;
  }
}

async function add(numbers) {
  const set = await load();
  for (const x of numbers) {
    const n = norm(x);
    if (n) set.add(n);
  }
  await save(set);
  return set.size;
}

async function remove(number) {
  const set = await load();
  set.delete(norm(number));
  await save(set);
  return set.size;
}

async function replaceAll(numbers) {
  const set = new Set();
  for (const x of numbers) {
    const n = norm(x);
    if (n) set.add(n);
  }
  await save(set);
  return set.size;
}

async function count() {
  return (await load()).size;
}

module.exports = { norm, isAllowed, add, remove, replaceAll, count };
