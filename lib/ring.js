// Rings the owner: their phone number, the Android app, or both, depending on their setting.
const settings = require('./settings');
const contacts = require('./contacts');
const tenant = require('./tenant');

// vr: the TwiML response. info: the encoded caller details carried to /api/dial-done.
// whisper: play "press 1 to accept" on the phone-number leg (not used for contacts).
async function dialOwner(vr, { t, c, info, summary, category, from, whisper }) {
  const mode = await settings.ringMode(t);
  const dial = vr.dial({ timeout: c.ringSeconds, answerOnBridge: true, action: `/api/dial-done?i=${info}`, method: 'POST' });

  if (mode !== 'app') {
    if (whisper && c.whisper) dial.number({ url: `/api/whisper?i=${info}`, method: 'POST' }, c.ownerPhone);
    else dial.number(c.ownerPhone);
  }

  if (mode !== 'phone') {
    // The app's incoming-call screen shows these, so there is no whisper on this leg.
    let name = '';
    try {
      name = (await contacts.loadNames(tenant.ns(t)))[contacts.norm(from)] || '';
    } catch (_) {}
    const client = dial.client();
    client.identity(tenant.identity(t));
    const params = { summary: String(summary || '').slice(0, 200), category: String(category || ''), from: String(from || ''), name };
    for (const [k, v] of Object.entries(params)) if (v) client.parameter({ name: k, value: v });
  }
  return mode;
}

module.exports = { dialOwner };
