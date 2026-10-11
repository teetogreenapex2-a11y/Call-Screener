// Manage customers: add one (buys their number and makes their private app link), list, remove.
// Only your ADMIN_KEY works here. Used by public/admin.html.
const { keyOk, requestKey } = require('../lib/admin');
const store = require('../lib/store');
const users = require('../lib/users');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

const pub = (u) => ({ id: u.id, name: u.name, cell: u.cell, number: u.number, created: u.created });

module.exports = async function handler(req, res) {
  if (!keyOk(requestKey(req))) return json(res, 403, { error: 'forbidden' });
  if (!store.configured()) return json(res, 200, { error: 'The settings database is not connected in Vercel yet.' });
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.action === 'create') {
        const { user, token } = await users.create({ name: b.name, cell: b.cell, areaCode: b.areaCode, context: b.context, host });
        return json(res, 200, { created: pub(user), link: `https://${host}/?key=${token}`, users: (await users.list()).map(pub) });
      }
      if (b.action === 'delete') await users.remove(String(b.id || ''));
      else if (b.action === 'newlink') {
        const token = await users.rotate(String(b.id || ''));
        if (!token) return json(res, 200, { error: 'No such customer.' });
        return json(res, 200, { link: `https://${host}/?key=${token}`, users: (await users.list()).map(pub) });
      } else if (b.action) return json(res, 400, { error: 'unknown action' });
    }
    return json(res, 200, { users: (await users.list()).map(pub) });
  } catch (err) {
    console.error('admin request failed:', err && err.message);
    return json(res, 200, { error: String((err && err.message) || "Couldn't do that.").slice(0, 200) });
  }
};
