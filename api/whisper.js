// Twilio fetches this on YOUR leg of the call when you answer, before the caller is connected.
// You hear who is calling. Press 1 to take it; press 2, say nothing, or hang up to decline.
const { isValid } = require('../lib/twilio-verify');
const { cfg } = require('../lib/config');
const store = require('../lib/store');
const tenant = require('../lib/tenant');
const { VoiceResponse, sayTo, decodeInfo, reply, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const url = new URL(req.url, 'http://localhost');
  const info = decodeInfo(url.searchParams.get('i'));
  const c = cfg(await tenant.forId(info.u));
  const b = req.body || {};
  const vr = new VoiceResponse();

  // Pressed 1: an empty response lets Twilio connect the caller.
  if (String(b.Digits || '') === '1') return reply(res, vr);

  // Pressed anything else, or did not press: decline. Remember it so /api/dial-done offers voicemail.
  if (b.Digits || url.searchParams.get('no') === '1') {
    if (store.configured() && b.ParentCallSid) {
      try {
        await store.set('declined:' + b.ParentCallSid, '1', 600);
      } catch (err) {
        console.error('could not record decline:', err && err.message);
      }
    }
    vr.hangup();
    return reply(res, vr);
  }

  const who = info.s ? `${info.c} call. ${info.s}` : 'A call.';
  const g = vr.gather({
    input: 'dtmf',
    numDigits: 1,
    timeout: 8,
    action: `/api/whisper?i=${url.searchParams.get('i') || ''}`,
    method: 'POST',
  });
  sayTo(g, c, `${who} Press 1 to accept, or 2 to decline.`);
  vr.redirect({ method: 'POST' }, `/api/whisper?i=${url.searchParams.get('i') || ''}&no=1`);
  return reply(res, vr);
};
