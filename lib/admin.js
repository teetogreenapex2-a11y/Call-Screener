const crypto = require('crypto');

// ADMIN_KEY is your password for the app and the contacts page (12+ random characters).
function keyOk(k) {
  const want = process.env.ADMIN_KEY || '';
  if (want.length < 8) return false;
  const a = Buffer.from(want);
  const b = Buffer.from(String(k || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// The key can come in the x-admin-key header (the app) or a ?key= parameter (the contacts page).
function requestKey(req) {
  const h = req.headers && req.headers['x-admin-key'];
  if (h) return h;
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('key');
  } catch (_) {
    return '';
  }
}

module.exports = { keyOk, requestKey };
