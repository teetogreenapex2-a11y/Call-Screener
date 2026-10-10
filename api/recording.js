// Twilio calls this when a voicemail recording is saved.
// Twilio only transcribes messages longer than 2 seconds. Those get their notification from
// /api/transcription (with the words in it). Everything else is handled here.
const { isValid } = require('../lib/twilio-verify');
const notify = require('../lib/notify');
const { listenUrl } = require('../lib/links');
const { decodeInfo, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const b = req.body || {};
  const info = decodeInfo(new URL(req.url, 'http://localhost').searchParams.get('i'));
  const status = String(b.RecordingStatus || '').toLowerCase();
  const seconds = parseInt(b.RecordingDuration || '0', 10) || 0;
  const link = listenUrl(req, b.RecordingSid);
  const who = `[${info.c}] ${info.f}: ${info.s}`;

  if (status === 'failed') {
    await notify.send({ title: 'Voicemail failed', body: `A voicemail could not be saved. ${who}` });
  } else if (seconds <= 1) {
    await notify.send({ title: 'Missed call', body: `Caller left no message. ${who}` });
  } else if (seconds === 2) {
    await notify.send({ title: 'New voicemail', body: `Very short voicemail (${seconds}s). ${who}${link ? ` Listen: ${link}` : ''}` });
  }
  // Longer messages are announced by /api/transcription.

  res.statusCode = 200;
  res.end('ok');
};
