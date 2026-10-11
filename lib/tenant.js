// Works out whose call this is. The dialed number (or the id carried in the URL) picks a customer;
// anything else is you, the owner, using the original settings from the Vercel variables.
const users = require('./users');
const { cfg } = require('./config');
const { keyOk, requestKey } = require('./admin');

// The owner. id is empty, so data keeps its original keys and nothing changes for the original setup.
function owner() {
  const c = cfg();
  return { id: '', name: c.ownerName, cell: c.ownerPhone, context: c.ownerContext, ntfy: process.env.NTFY_TOPIC || '', owner: true };
}

async function forId(id) {
  if (!id) return owner();
  return (await users.byId(id)) || owner();
}

// From the URL's u= parameter if present, otherwise from the number that was dialed.
async function forRequest(req) {
  let uid = '';
  try {
    uid = new URL(req.url, 'http://localhost').searchParams.get('u') || '';
  } catch (_) {}
  if (uid) return forId(uid);
  const to = (req.body || {}).To;
  return (to && (await users.byNumber(to))) || owner();
}

// Data key prefix for a customer (empty for the owner).
const ns = (t) => (t && t.id ? `u:${t.id}:` : '');

// Extra notify options: customers get their own push topic and never a text from the owner's number.
const notifyOpts = (t) => (t && t.id ? { topic: t.ntfy, sms: false } : {});

// The name the Android app registers under with Twilio, so calls can be sent to it.
const identity = (t) => (t && t.id ? `u${t.id}` : 'owner');

// Who is asking (the app and the Android app): your ADMIN_KEY is you; a customer's private key is them; otherwise null.
async function authenticate(req) {
  const k = requestKey(req);
  if (keyOk(k)) return owner();
  return users.byToken(k);
}

module.exports = { authenticate, owner, forId, forRequest, ns, notifyOpts, identity };
