// Twilio calls this when the ring-through to your phone ends.
// Answered: nothing more to do. Not answered: take a voicemail if you have it switched on.
const { isValid } = require('../lib/twilio-verify');
const { cfg } = require('../lib/config');
const notify = require('../lib/notify');
const settings = require('../lib/settings');
const { VoiceResponse, sayTo, encodeInfo, decodeInfo, reply, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const c = cfg();
  const url = new URL(req.url, 'http://localhost');
  const info = decodeInfo(url.searchParams.get('i'));
  const status = String((req.body || {}).DialCallStatus || '').toLowerCase();
  const detail = `[${info.c}]: ${info.s} (${info.f})`;
  const vr = new VoiceResponse();

  if (status === 'completed' || status === 'answered') {
    vr.hangup();
    return reply(res, vr);
  }

  if (status === 'canceled') {
    await notify.send({ title: 'Missed call', body: `Caller hung up while ringing ${detail}` });
    vr.hangup();
    return reply(res, vr);
  }

  const sorry = `Sorry, ${c.ownerName} can't take your call right now.`;

  if (!(await settings.voicemailEnabled())) {
    sayTo(vr, c, `${sorry} Goodbye.`);
    vr.hangup();
    await notify.send({ title: 'Missed call', body: `Missed call ${detail}` });
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
