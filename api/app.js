// Data and actions for the phone app (public/index.html). Everything needs your ADMIN_KEY.
const { keyOk, requestKey } = require('../lib/admin');
const settings = require('../lib/settings');
const contacts = require('../lib/contacts');
const calls = require('../lib/calls');
const store = require('../lib/store');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function snapshot() {
  const [voicemail, list, count] = await Promise.all([
    settings.voicemailEnabled(),
    calls.list(),
    contacts.count().catch(() => 0),
  ]);
  return { voicemail, calls: list, contacts: count };
}

module.exports = async function handler(req, res) {
  if (!keyOk(requestKey(req))) return json(res, 403, { error: 'forbidden' });
  if (!store.configured()) return json(res, 200, { error: 'The settings database is not connected in Vercel yet.' });

  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'voicemail') await settings.setVoicemail(Boolean(b.on));
      else if (b.action === 'allow') await contacts.add([b.number]);
      else if (b.action === 'unallow') await contacts.remove(b.number);
      else if (b.action === 'import') {
        const nums = Array.isArray(b.numbers) ? b.numbers.slice(0, 20000) : [];
        if (b.replace) await contacts.replaceAll(nums);
        else await contacts.add(nums);
      } else if (b.action === 'clear-calls') await store.set('calls', '[]');
      else if (b.action !== 'refresh') return json(res, 400, { error: 'unknown action' });
    }
    return json(res, 200, await snapshot());
  } catch (err) {
    console.error('app request failed:', err && err.message);
    return json(res, 200, { error: "Couldn't save that. Try again in a minute." });
  }
};
