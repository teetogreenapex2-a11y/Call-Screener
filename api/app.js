// Data and actions for the phone app (public/index.html).
// Your ADMIN_KEY opens your own app; a customer's personal key opens theirs.
const settings = require('../lib/settings');
const contacts = require('../lib/contacts');
const calls = require('../lib/calls');
const store = require('../lib/store');
const tenant = require('../lib/tenant');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function snapshot(t) {
  const ns = tenant.ns(t);
  const [voicemail, rawCalls, count, names, synced] = await Promise.all([
    settings.voicemailEnabled(t),
    calls.list(ns),
    contacts.count(ns).catch(() => 0),
    contacts.loadNames(ns),
    contacts.lastSynced(ns),
  ]);
  const list = rawCalls.map((c) => ({ ...c, name: names[contacts.norm(c.f)] || '' }));
  const me = t.owner
    ? { name: t.name, number: process.env.TWILIO_PHONE_NUMBER || '', ntfy: t.ntfy }
    : { name: t.name, number: t.number, ntfy: t.ntfy };
  return { voicemail, calls: list, contacts: count, synced, me, ring: await settings.ringMode(t) };
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return json(res, 200, { error: 'The settings database is not connected in Vercel yet.' });
  const t = await tenant.authenticate(req);
  if (!t) return json(res, 403, { error: 'forbidden' });
  const ns = tenant.ns(t);

  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'voicemail') await settings.setVoicemail(Boolean(b.on), t);
      else if (b.action === 'ringmode') {
        if (!settings.MODES.includes(b.mode)) return json(res, 400, { error: 'unknown ring mode' });
        await settings.setRingMode(b.mode, t);
      } else if (b.action === 'allow') await contacts.add([b.number], ns);
      else if (b.action === 'unallow') await contacts.remove(b.number, ns);
      else if (b.action === 'import') {
        // entries: [{ n, name }] from the phone's contacts; numbers: plain list.
        const entries = Array.isArray(b.entries) ? b.entries.slice(0, 20000) : (Array.isArray(b.numbers) ? b.numbers.slice(0, 20000) : []).map((n) => ({ n }));
        await contacts.importEntries(entries, ns, Boolean(b.replace));
      } else if (b.action === 'contacts') return json(res, 200, { contactList: await contacts.listAll(ns) });
      else if (b.action === 'clear-calls') await store.set(calls.keyFor(ns), '[]');
      else if (b.action !== 'refresh') return json(res, 400, { error: 'unknown action' });
    }
    return json(res, 200, await snapshot(t));
  } catch (err) {
    console.error('app request failed:', err && err.message);
    return json(res, 200, { error: "Couldn't save that. Try again in a minute." });
  }
};
