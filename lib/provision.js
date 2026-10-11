// Buys and releases a Twilio phone number for a customer. Kept separate so tests can replace it.
const twilio = require('twilio');

let client = null;
function getClient() {
  if (!client) client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

// Buys a local US number (preferably in the area code), points its calls and texts at this app.
async function buy({ areaCode, host, label }) {
  const c = getClient();
  const base = { voiceEnabled: true, limit: 1 };
  let found = [];
  if (areaCode) found = await c.availablePhoneNumbers('US').local.list({ ...base, areaCode: Number(areaCode) });
  if (!found.length) found = await c.availablePhoneNumbers('US').local.list(base);
  if (!found.length) throw new Error('No phone numbers available right now.');
  const n = await c.incomingPhoneNumbers.create({
    phoneNumber: found[0].phoneNumber,
    voiceUrl: `https://${host}/api/voice`,
    voiceMethod: 'POST',
    smsUrl: `https://${host}/api/sms`,
    smsMethod: 'POST',
    friendlyName: `screener ${String(label || '').slice(0, 40)}`,
  });
  return { number: n.phoneNumber, sid: n.sid };
}

async function release(sid) {
  await getClient().incomingPhoneNumbers(sid).remove();
}

module.exports = { buy, release };
