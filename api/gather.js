// Twilio calls this after each time the caller speaks (or stays silent).
// Claude decides: ask another question, ring the owner, or reject.
const { isValid } = require('../lib/twilio-verify');
const { cfg, greeting } = require('../lib/config');
const claude = require('../lib/claude');
const notify = require('../lib/notify');
const { VoiceResponse, decode, sayTo, buildGather, reply, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const c = cfg();
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
      await notify.send({ title: 'Call blocked', body: `Blocked [robocall]: ${from} never spoke.` });
      return reply(res, vr);
    }
    const prompt = "Sorry, I didn't catch that. Please say your name and why you're calling.";
    history.push({ who: 'assistant', text: prompt });
    buildGather(vr, c, round + 1, history, prompt);
    return reply(res, vr);
  }

  history.push({ who: 'caller', text: speech });
  const d = await claude.decide({ from, stir: body.StirVerstat, history, round });

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
      vr.dial({ timeout: 25, answerOnBridge: true }, c.ownerPhone);
    }
    await notify.send({ title: 'Call coming through', body: `Ringing you [${d.category}]: ${d.summary} (${from})` });
    return reply(res, vr);
  }

  sayTo(vr, c, "Thanks. I'm not able to connect this call. Goodbye.");
  vr.hangup();
  await notify.send({ title: 'Call blocked', body: `Blocked [${d.category}]: ${d.summary} (${from})` });
  return reply(res, vr);
};
