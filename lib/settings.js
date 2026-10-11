const store = require('./store');
const { cfg } = require('./config');

// The voicemail on/off setting. The owner's key is the original one; each customer has their own.
const key = (t) => (t && t.id ? `u:${t.id}:voicemail_enabled` : 'voicemail_enabled');

// True if callers who reach you but get no answer should be able to leave a message.
// Falls back to VOICEMAIL_DEFAULT (off unless you set it) if the database is empty or unreachable.
async function voicemailEnabled(t) {
  try {
    const v = await store.get(key(t));
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (err) {
    console.error('settings read failed:', err && err.message);
  }
  return cfg(t).voicemailDefault;
}

async function setVoicemail(on, t) {
  await store.set(key(t), on ? '1' : '0');
}

module.exports = { voicemailEnabled, setVoicemail };
