// Twilio calls this when someone dials your screening number.
const { isValid } = require('../lib/twilio-verify');
const { cfg, greeting } = require('../lib/config');
const contacts = require('../lib/contacts');
const notify = require('../lib/notify');
const tenant = require('../lib/tenant');
const ring = require('../lib/ring');
const { VoiceResponse, buildGather, encodeInfo, reply, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const t = await tenant.forRequest(req);
  const c = cfg(t);
  const b = req.body || {};

  // Saved contacts ring straight through. A caller ID that failed carrier verification (spoofed) does not get this.
  const spoofed = /^TN-Validation-Failed/i.test(String(b.StirVerstat || ''));
  if (c.ownerPhone && !spoofed && (await contacts.isAllowed(b.From, tenant.ns(t)))) {
    const info = encodeInfo({ s: 'Saved contact', c: 'contact', f: b.From || 'unknown', u: t.id });
    const vr = new VoiceResponse();
    await ring.dialOwner(vr, { t, c, info, summary: 'Saved contact', category: 'contact', from: b.From, whisper: false });
    await notify.send({ title: 'Contact calling', body: `Ringing you [contact]: ${b.From}`, ...tenant.notifyOpts(t) });
    return reply(res, vr);
  }

  const text = greeting(c);
  const vr = new VoiceResponse();
  buildGather(vr, c, 0, [{ who: 'assistant', text }], text);
  return reply(res, vr);
};
