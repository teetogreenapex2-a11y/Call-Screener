const twilio = require('twilio');

// Rebuild the exact URL Twilio called (it signs the full URL including the query string).
function fullUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}${req.url}`;
}

// Only Twilio should be able to drive this app. Anything without a valid signature is rejected.
function isValid(req) {
  if (process.env.SKIP_TWILIO_VALIDATION === '1') return true;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers['x-twilio-signature'];
  if (!token || !signature) return false;
  return twilio.validateRequest(token, signature, fullUrl(req), req.body || {});
}

module.exports = { isValid, fullUrl };
