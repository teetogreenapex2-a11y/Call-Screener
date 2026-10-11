const store = require('./store');

const keyFor = (ns) => `${ns || ''}allowlist`;
const namesKey = (ns) => `${ns || ''}contactnames`;
const MAX_NAMES = 5000;
const syncKey = (ns) => `${ns || ''}contactsynced`;

// Phone numbers are compared by their last 10 digits, so +1 (919) 555-1234 and 9195551234 match.
function norm(s) {
  const d = String(s || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

async function load(ns) {
  const raw = await store.get(keyFor(ns));
  return new Set(String(raw || '').split(',').filter(Boolean));
}

async function save(set, ns) {
  await store.set(keyFor(ns), [...set].join(','));
}

// True if this caller is on your always-ring-through list. Any error means "no", so the call is screened as usual.
async function isAllowed(from, ns) {
  const n = norm(from);
  if (!n || !store.configured()) return false;
  try {
    return (await load(ns)).has(n);
  } catch (err) {
    console.error('contacts read failed:', err && err.message);
    return false;
  }
}

async function add(numbers, ns) {
  const set = await load(ns);
  for (const x of numbers) {
    const n = norm(x);
    if (n) set.add(n);
  }
  await save(set, ns);
  return set.size;
}

async function remove(number, ns) {
  const set = await load(ns);
  set.delete(norm(number));
  await save(set, ns);
  try {
    const names = await loadNames(ns);
    if (names[norm(number)]) {
      delete names[norm(number)];
      await store.set(namesKey(ns), JSON.stringify(names));
    }
  } catch (_) {}
  return set.size;
}

async function replaceAll(numbers, ns) {
  const set = new Set();
  for (const x of numbers) {
    const n = norm(x);
    if (n) set.add(n);
  }
  await save(set, ns);
  return set.size;
}

async function count(ns) {
  return (await load(ns)).size;
}

// Names are kept beside the numbers so the app can show "Mike Smith" instead of a number. Best effort: never blocks a call.
async function loadNames(ns) {
  try {
    const o = JSON.parse((await store.get(namesKey(ns))) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_) {
    return {};
  }
}

// entries: [{ n: number, name: optional }]. replace = start the list over.
async function importEntries(entries, ns, replace) {
  const nums = [];
  const names = replace ? {} : await loadNames(ns);
  for (const e of entries) {
    const n = norm(e && e.n);
    if (!n) continue;
    nums.push(n);
    const nm = String((e && e.name) || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (nm) names[n] = nm;
  }
  const total = replace ? await replaceAll(nums, ns) : await add(nums, ns);
  store.set(syncKey(ns), String(Date.now())).catch(() => {});
  const keys = Object.keys(names);
  if (keys.length > MAX_NAMES) for (const k of keys.slice(0, keys.length - MAX_NAMES)) delete names[k];
  try {
    await store.set(namesKey(ns), JSON.stringify(names));
  } catch (err) {
    console.error('contact names save failed:', err && err.message);
  }
  return total;
}

// When the list was last loaded from the phone (ms), or 0 if never.
async function lastSynced(ns) {
  try {
    return Number(await store.get(syncKey(ns))) || 0;
  } catch (_) {
    return 0;
  }
}

// Everyone on the list with their name if known, sorted by name (numbers without names last).
async function listAll(ns) {
  const [set, names] = await Promise.all([load(ns), loadNames(ns)]);
  return [...set]
    .map((n) => ({ n, name: names[n] || '' }))
    .sort((a, b) => (a.name && !b.name ? -1 : !a.name && b.name ? 1 : (a.name || a.n).localeCompare(b.name || b.n)));
}

module.exports = { lastSynced, listAll, loadNames, importEntries, norm, isAllowed, add, remove, replaceAll, count };
