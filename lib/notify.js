const twilio = require('twilio');

let sms = null;
function getSms() {
  if (!sms) sms = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return sms;
}

// Tells the owner what happened. Never throws; a failed notification must not break a call.
// Options: max = longest message (voicemail transcripts need more room), sms = false skips the text message.
async function send({ title, body, max = 300, sms: viaSms = true }) {
  const e = process.env;
  const text = String(body || '').slice(0, max);
  console.log(`[screened] ${title}: ${text}`);

  const jobs = [];

  if (viaSms && e.NOTIFY_SMS !== '0' && e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_PHONE_NUMBER && e.OWNER_PHONE) {
    jobs.push(getSms().messages.create({ from: e.TWILIO_PHONE_NUMBER, to: e.OWNER_PHONE, body: `${title}: ${text}` }));
  }

  if (e.NTFY_TOPIC) {
    jobs.push(
      fetch(`https://ntfy.sh/${encodeURIComponent(e.NTFY_TOPIC)}`, {
        method: 'POST',
        headers: { Title: title },
        body: text,
        signal: AbortSignal.timeout(4000),
      })
    );
  }

  const results = await Promise.allSettled(jobs);
  for (const r of results) {
    if (r.status === 'rejected') console.error('notify failed:', r.reason && r.reason.message);
  }
}

module.exports = { send };
