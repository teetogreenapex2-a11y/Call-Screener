// Customer accounts. Each customer has their own cell number, screening number, settings, contacts and call list.
// Stored in the same Redis database: user:<id> (the record), num:<10 digits> and tok:<hash> (lookups), users (the index).
const crypto = require('crypto');
const store = require('./store');
const provision = require('./provision');
const { norm } = require('./contacts');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n) => crypto.randomBytes(n);

async function readJson(key, fallback) {
  try {
    const raw = await store.get(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

async function byId(id) {
  if (!/^[a-z0-9]{4,16}$/i.test(String(id || ''))) return null;
  return readJson(`user:${id}`, null);
}

async function byNumber(to) {
  const n = norm(to);
  if (!n || !store.configured()) return null;
  try {
    const id = await store.get(`num:${n}`);
    return id ? await byId(id) : null;
  } catch (_) {
    return null;
  }
}

async function byToken(token) {
  if (!token || !store.configured()) return null;
  try {
    const id = await store.get(`tok:${sha(token)}`);
    return id ? await byId(id) : null;
  } catch (_) {
    return null;
  }
}

async function list() {
  const ids = await readJson('users', []);
  const out = [];
  for (const id of ids) {
    const u = await byId(id);
    if (u) out.push(u);
  }
  return out;
}

// Buys a number, saves the account and returns the private app link token (shown once).
async function create({ name, cell, areaCode, context, host }) {
  const cleanName = String(name || '').trim().slice(0, 40);
  const cellN = norm(cell);
  if (!cleanName) throw new Error('A name is required.');
  if (!cellN) throw new Error('A 10-digit cell number is required.');

  const id = rand(5).toString('hex');
  const token = rand(18).toString('base64url');
  const bought = await provision.buy({ areaCode, host, label: cleanName });
  const user = {
    id,
    name: cleanName,
    cell: '+1' + cellN,
    context: String(context || '').trim().slice(0, 600),
    number: bought.number,
    numberSid: bought.sid,
    ntfy: 'screener-' + rand(12).toString('hex'),
    created: Date.now(),
    tokHash: sha(token),
  };
  try {
    await store.set(`user:${id}`, JSON.stringify(user));
    await store.set(`num:${norm(bought.number)}`, id);
    await store.set(`tok:${sha(token)}`, id);
    const ids = await readJson('users', []);
    ids.push(id);
    await store.set('users', JSON.stringify(ids));
  } catch (err) {
    await provision.release(bought.sid).catch(() => {});
    throw err;
  }
  return { user, token };
}

// Releases the number and deletes the account's login and settings.
async function remove(id) {
  const u = await byId(id);
  if (!u) return false;
  await provision.release(u.numberSid).catch((err) => console.error('release failed:', err && err.message));
  for (const k of [`num:${norm(u.number)}`, `tok:${u.tokHash}`, `user:${id}`, `u:${id}:voicemail_enabled`, `u:${id}:allowlist`, `u:${id}:calls`]) {
    await store.del(k).catch(() => {});
  }
  const ids = (await readJson('users', [])).filter((x) => x !== id);
  await store.set('users', JSON.stringify(ids));
  return true;
}

// A new login link for a customer. The old link stops working.
async function rotate(id) {
  const u = await byId(id);
  if (!u) return null;
  const token = rand(18).toString('base64url');
  await store.set(`tok:${sha(token)}`, id);
  if (u.tokHash) await store.del(`tok:${u.tokHash}`).catch(() => {});
  await store.set(`user:${id}`, JSON.stringify({ ...u, tokHash: sha(token) }));
  return token;
}

module.exports = { byId, byNumber, byToken, list, create, remove, rotate };
