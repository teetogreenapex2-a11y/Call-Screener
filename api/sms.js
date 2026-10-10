// Twilio calls this when someone texts your Twilio number.
// Text VM ON or VM OFF from your own phone to switch voicemail. Text VM to check the setting.
const twilio = require('twilio');
const { isValid } = require('../lib/twilio-verify');
const { cfg } = require('../lib/config');
const notify = require('../lib/notify');
const settings = require('../lib/settings');
const store = require('../lib/store');
const { forbidden } = require('../lib/twiml');

const last10 = (s) => String(s || '').replace(/\D/g, '').slice(-10);

function xml(res, message) {
  const mr = new twilio.twiml.MessagingResponse();
  if (message) mr.message(message);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml');
  res.end(mr.toString());
}

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const c = cfg();
  const b = req.body || {};

  // Only your own phone can change settings. Anyone else is ignored without a reply.
  if (!c.ownerPhone || last10(b.From) !== last10(c.ownerPhone)) return xml(res, '');

  const text = String(b.Body || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = text.match(/^(?:vm|voicemail)(?: (on|off|status))?$/);
  let message;

  if (!m) {
    message = 'Text VM ON or VM OFF to switch voicemail, or VM to check it.';
  } else if (m[1] === 'on' || m[1] === 'off') {
    if (!store.configured()) {
      message = "I can't save that yet: the settings database isn't connected in Vercel.";
    } else {
      try {
        await settings.setVoicemail(m[1] === 'on');
        message = `Voicemail is now ${m[1].toUpperCase()}.`;
      } catch (err) {
        console.error('could not save voicemail setting:', err && err.message);
        message = "Couldn't save that. Try again in a minute.";
      }
    }
  } else {
    message = `Voicemail is ${(await settings.voicemailEnabled()) ? 'ON' : 'OFF'}.`;
  }

  // Text replies from a new Twilio number can be filtered by carriers, so also send a push notification.
  await notify.send({ title: 'Voicemail setting', body: message, sms: false });
  return xml(res, message);
};
