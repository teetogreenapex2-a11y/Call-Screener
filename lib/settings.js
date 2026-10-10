const store = require('./store');
const { cfg } = require('./config');

const VOICEMAIL_KEY = 'voicemail_enabled';

// True if callers who reach you but get no answer should be able to leave a message.
// Falls back to VOICEMAIL_DEFAULT (off unless you set it) if the database is empty or unreachable.
async function voicemailEnabled() {
  try {
    const v = await store.get(VOICEMAIL_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (err) {
    console.error('settings read failed:', err && err.message);
  }
  return cfg().voicemailDefault;
}

async function setVoicemail(on) {
  await store.set(VOICEMAIL_KEY, on ? '1' : '0');
}

module.exports = { voicemailEnabled, setVoicemail };
