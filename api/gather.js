// Twilio calls this after each time the caller speaks (or stays silent).
// Claude decides: ask another question, ring the owner, or reject.
const { isValid } = require('../lib/twilio-verify');
const { cfg, greeting } = require('../lib/config');
const claude = require('../lib/claude');
const notify = require('../lib/notify');
const calls = require('../lib/calls');
const tenant = require('../lib/tenant');
const ring = require('../lib/ring');
const { VoiceResponse, decode, encodeInfo, sayTo, buildGather, reply, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const t = await tenant.forRequest(req);
  const ns = tenant.ns(t);
  const c = cfg(t);
  const url = new URL(req.url, 'http://localhost');
  const round = Math.max(0, parseInt(url.searchParams.get('r') || '0', 10) || 0);
  const history = decode(url.searchParams.get('t'));
  const body = req.body || {};
  const speech = String(body.SpeechResult || '').trim();
  const from = body.From || 'unknown';

  if (history.length === 0) history.push({ who: 'assistant', text: greeting(c) });

  const vr = new VoiceResponse();

  // Caller said nothing: one more try, then hang up (typical of robocalls).
  if (!speech) {
    if (round >= 1) {
      sayTo(vr, c, "Sorry, I couldn't hear anything. Goodbye.");
      vr.hangup();
      await calls.log({ f: from, c: 'robocall', s: 'Never spoke', o: 'blocked' }, ns);
      await notify.send({ title: 'Call blocked', body: `Blocked [robocall]: ${from} never spoke.`, ...tenant.notifyOpts(t) });
      return reply(res, vr);
    }
    const prompt = "Sorry, I didn't catch that. Please say your name and why you're calling.";
    history.push({ who: 'assistant', text: prompt });
    buildGather(vr, c, round + 1, history, prompt);
    return reply(res, vr);
  }

  history.push({ who: 'caller', text: speech });
  const d = await claude.decide({ from, stir: body.StirVerstat, history, round, t });

  if (d.action === 'ask') {
    history.push({ who: 'assistant', text: d.say });
    buildGather(vr, c, round + 1, history, d.say);
    return reply(res, vr);
  }

  if (d.action === 'ring') {
    if (!c.ownerPhone) {
      console.error('OWNER_PHONE is not set, cannot connect the call');
      sayTo(vr, c, "Sorry, I can't connect your call right now. Goodbye.");
      vr.hangup();
    } else {
      sayTo(vr, c, 'Thank you. Please hold while I connect you.');
      // If you don't pick up, /api/dial-done takes over (voicemail or a goodbye, depending on your setting).
      const info = encodeInfo({ s: d.summary, c: d.category, f: from, u: t.id });
      // Rings your phone and/or the app (see lib/ring.js). On the phone leg you hear who it is and press 1.
      await ring.dialOwner(vr, { t, c, info, summary: d.summary, category: d.category, from, whisper: true });
    }
    await notify.send({ title: 'Call coming through', body: `Ringing you [${d.category}]: ${d.summary} (${from})`, ...tenant.notifyOpts(t) });
    return reply(res, vr);
  }

  sayTo(vr, c, "Thanks. I'm not able to connect this call. Goodbye.");
  vr.hangup();
  await calls.log({ f: from, c: d.category, s: d.summary, o: 'blocked' }, ns);
  await notify.send({ title: 'Call blocked', body: `Blocked [${d.category}]: ${d.summary} (${from})`, ...tenant.notifyOpts(t) });
  return reply(res, vr);
};
