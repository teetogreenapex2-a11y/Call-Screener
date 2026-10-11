// Twilio calls this when someone texts your Twilio number.
// Text VM ON or VM OFF from your own phone to switch voicemail. Text VM to check the setting.
const twilio = require('twilio');
const { isValid } = require('../lib/twilio-verify');
const { cfg } = require('../lib/config');
const notify = require('../lib/notify');
const settings = require('../lib/settings');
const store = require('../lib/store');
const contacts = require('../lib/contacts');
const tenant = require('../lib/tenant');
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

  const t = await tenant.forRequest(req);
  const ns = tenant.ns(t);
  const c = cfg(t);
  const b = req.body || {};

  // Only your own phone can change settings. Anyone else is ignored without a reply.
  if (!c.ownerPhone || last10(b.From) !== last10(c.ownerPhone)) return xml(res, '');

  const text = String(b.Body || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const m = text.match(/^(?:vm|voicemail)(?: (on|off|status))?$/);
  const al = String(b.Body || '').trim().match(/^(allow|unallow)\s+(.+)$/i);
  let message;

  if (al) {
    const n = contacts.norm(al[2]);
    if (!n) {
      message = 'Send ALLOW or UNALLOW followed by a 10-digit number.';
    } else if (!store.configured()) {
      message = "I can't save that yet: the settings database isn't connected in Vercel.";
    } else {
      try {
        const adding = al[1].toLowerCase() === 'allow';
        const total = adding ? await contacts.add([n], ns) : await contacts.remove(n, ns);
        message = `${adding ? 'Added' : 'Removed'} ${n}. ${total} numbers on the ring-through list.`;
      } catch (err) {
        console.error('could not save contact:', err && err.message);
        message = "Couldn't save that. Try again in a minute.";
      }
    }
  } else if (!m) {
    message = 'Text VM ON or VM OFF to switch voicemail, or VM to check it. ALLOW 9195551234 adds a contact.';
  } else if (m[1] === 'on' || m[1] === 'off') {
    if (!store.configured()) {
      message = "I can't save that yet: the settings database isn't connected in Vercel.";
    } else {
      try {
        await settings.setVoicemail(m[1] === 'on', t);
        message = `Voicemail is now ${m[1].toUpperCase()}.`;
      } catch (err) {
        console.error('could not save voicemail setting:', err && err.message);
        message = "Couldn't save that. Try again in a minute.";
      }
    }
  } else {
    message = `Voicemail is ${(await settings.voicemailEnabled(t)) ? 'ON' : 'OFF'}.`;
  }

  // Text replies from a new Twilio number can be filtered by carriers, so also send a push notification.
  await notify.send({ title: 'Voicemail setting', body: message, sms: false, ...tenant.notifyOpts(t) });
  // With NOTIFY_SMS=0 (new number not yet registered for texting, or a number shared with another app)
  // this app never sends a text of its own, so the reply is left empty and only the push confirms.
  return xml(res, t.id || process.env.NOTIFY_SMS === '0' ? '' : message);
};
