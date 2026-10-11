// Gives the Android app a Twilio access token so Twilio can ring it. Needs your ADMIN_KEY or a customer's private key.
const twilio = require('twilio');
const settings = require('../lib/settings');
const store = require('../lib/store');
const tenant = require('../lib/tenant');

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  if (!store.configured()) return json(res, 200, { error: 'The settings database is not connected in Vercel yet.' });
  const t = await tenant.authenticate(req);
  if (!t) return json(res, 403, { error: 'forbidden' });

  const e = process.env;
  const missing = ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_PUSH_CREDENTIAL_SID'].filter((k) => !e[k]);
  if (missing.length) return json(res, 200, { error: `App calling is not set up on the server yet. Missing in Vercel: ${missing.join(', ')}` });

  try {
    const identity = tenant.identity(t);
    const { AccessToken } = twilio.jwt;
    const token = new AccessToken(e.TWILIO_ACCOUNT_SID, e.TWILIO_API_KEY_SID, e.TWILIO_API_KEY_SECRET, { identity, ttl: 86400 });
    token.addGrant(new AccessToken.VoiceGrant({ incomingAllow: true, pushCredentialSid: e.TWILIO_PUSH_CREDENTIAL_SID }));

    // The first time the app registers, send calls to it. After that the choice is yours (phone, app or both).
    if (!(await settings.ringModeIsSet(t))) await settings.setRingMode('app', t);

    return json(res, 200, { token: token.toJwt(), identity, mode: await settings.ringMode(t) });
  } catch (err) {
    console.error('voice token failed:', err && err.message);
    return json(res, 200, { error: "Couldn't create the app token." });
  }
};
