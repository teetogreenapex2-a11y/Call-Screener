// Twilio calls this when the voicemail has been turned into text. This is the notification you actually read.
const { isValid } = require('../lib/twilio-verify');
const notify = require('../lib/notify');
const calls = require('../lib/calls');
const { listenUrl } = require('../lib/links');
const { decodeInfo, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const b = req.body || {};
  const info = decodeInfo(new URL(req.url, 'http://localhost').searchParams.get('i'));
  const text = String(b.TranscriptionText || '').trim();
  const ok = String(b.TranscriptionStatus || '').toLowerCase() === 'completed' && text;
  const link = listenUrl(req, b.RecordingSid);
  const who = `[${info.c}] ${info.f}: ${info.s}`;
  const listen = link ? `\nListen: ${link}` : '';

  const body = ok ? `${who}\n"${text}"${listen}` : `${who}\nTranscript unavailable.${listen}`;
  await calls.log({ f: info.f, c: info.c, s: info.s, o: 'voicemail', v: ok ? text : 'Transcript unavailable', l: link });
  await notify.send({ title: 'New voicemail', body, max: 600 });

  res.statusCode = 200;
  res.end('ok');
};
