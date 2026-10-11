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

// Where screened calls ring: 'phone' (your cell number), 'app' (the Android app), or 'both'.
const ringKey = (t) => (t && t.id ? `u:${t.id}:ring_mode` : 'ring_mode');
const MODES = ['phone', 'app', 'both'];

async function ringMode(t) {
  try {
    const v = await store.get(ringKey(t));
    if (MODES.includes(v)) return v;
  } catch (err) {
    console.error('ring mode read failed:', err && err.message);
  }
  const d = String(process.env.RING_MODE || 'phone').toLowerCase();
  return MODES.includes(d) ? d : 'phone';
}

async function setRingMode(mode, t) {
  if (!MODES.includes(mode)) throw new Error('bad ring mode');
  await store.set(ringKey(t), mode);
}

// True once a ring mode has been chosen (by you in the app, or automatically when the Android app first registers).
async function ringModeIsSet(t) {
  try {
    return MODES.includes(await store.get(ringKey(t)));
  } catch (_) {
    return true; // if unsure, do not change anything
  }
}

module.exports = { voicemailEnabled, setVoicemail, ringMode, setRingMode, ringModeIsSet, MODES };
