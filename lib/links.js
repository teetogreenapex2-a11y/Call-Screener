const crypto = require('crypto');

const REC_SID = /^RE[0-9a-f]{32}$/i;

// Signed link so you can play a voicemail from a text message without logging in to Twilio.
// The signature uses your Twilio auth token, so only links this app created will play.
function sign(recSid) {
  return crypto
    .createHmac('sha256', process.env.TWILIO_AUTH_TOKEN || '')
    .update('listen:' + recSid)
    .digest('hex')
    .slice(0, 32);
}

function verify(recSid, k) {
  if (!REC_SID.test(String(recSid || ''))) return false;
  const a = Buffer.from(sign(recSid));
  const b = Buffer.from(String(k || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function listenUrl(req, recSid) {
  if (!REC_SID.test(String(recSid || ''))) return '';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}/api/listen?r=${recSid}&k=${sign(recSid)}`;
}

module.exports = { sign, verify, listenUrl, REC_SID };
