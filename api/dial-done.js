// Twilio calls this when the ring-through to your phone ends.
// Answered: nothing more to do. Not answered: take a voicemail if you have it switched on.
const { isValid } = require('../lib/twilio-verify');
const { cfg } = require('../lib/config');
const notify = require('../lib/notify');
const calls = require('../lib/calls');
const settings = require('../lib/settings');
const store = require('../lib/store');
const tenant = require('../lib/tenant');
const { VoiceResponse, sayTo, encodeInfo, decodeInfo, reply, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const url = new URL(req.url, 'http://localhost');
  const info = decodeInfo(url.searchParams.get('i'));
  const t = await tenant.forId(info.u);
  const ns = tenant.ns(t);
  const c = cfg(t);
  let status = String((req.body || {}).DialCallStatus || '').toLowerCase();

  // You picked up but pressed 2 (or nothing) on the whisper: treat it like a call you couldn't take.
  if ((status === 'completed' || status === 'answered') && store.configured()) {
    try {
      if (await store.get('declined:' + (req.body || {}).CallSid)) status = 'declined';
    } catch (_) {}
  }
  const detail = `[${info.c}]: ${info.s} (${info.f})`;
  const vr = new VoiceResponse();

  const entry = { f: info.f, c: info.c, s: info.s };

  if (status === 'completed' || status === 'answered') {
    await calls.log({ ...entry, o: 'answered' }, ns);
    vr.hangup();
    return reply(res, vr);
  }

  if (status === 'canceled') {
    await calls.log({ ...entry, o: 'missed' }, ns);
    await notify.send({ title: 'Missed call', body: `Caller hung up while ringing ${detail}`, ...tenant.notifyOpts(t) });
    vr.hangup();
    return reply(res, vr);
  }

  // If the app was the target and nothing answered, say so in the alert so you know where to look.
  let appHint = '';
  if (status !== 'canceled') {
    try {
      if ((await settings.ringMode(t)) !== 'phone') appHint = ' The Android app did not answer: check it has data or Wi-Fi and that notifications are allowed.';
    } catch (_) {}
  }

  const sorry = `Sorry, ${c.ownerName} isn't available right now.`;

  if (!(await settings.voicemailEnabled(t))) {
    sayTo(vr, c, `${sorry} Goodbye.`);
    vr.hangup();
    await calls.log({ ...entry, o: 'missed' }, ns);
    await notify.send({ title: 'Missed call', body: `Missed call ${detail}.${appHint}`, ...tenant.notifyOpts(t) });
    return reply(res, vr);
  }

  const i = encodeInfo(info);
  sayTo(vr, c, `${sorry} Please leave a message after the tone. Your message will be recorded and transcribed.`);
  vr.record({
    maxLength: 115,
    timeout: 5,
    playBeep: true,
    trim: 'trim-silence',
    finishOnKey: '#',
    recordingStatusCallback: `/api/recording?i=${i}`,
    recordingStatusCallbackMethod: 'POST',
    transcribe: true,
    transcribeCallback: `/api/transcription?i=${i}`,
  });
  sayTo(vr, c, 'No message received. Goodbye.');
  vr.hangup();
  return reply(res, vr);
};
