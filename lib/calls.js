const store = require('./store');

const KEY = 'calls';
const MAX = 100;

const clip = (s, n) => String(s || '').slice(0, n);

// Keeps the most recent calls for the app's call list. Never throws: a failed log must not affect a call.
async function log(e) {
  if (!store.configured()) return;
  try {
    const list = await read();
    list.unshift({
      t: Date.now(),
      f: clip(e.f, 30),
      c: clip(e.c || 'unclear', 20),
      s: clip(e.s, 200),
      o: clip(e.o, 20), // answered, missed, blocked, voicemail
      v: clip(e.v, 600), // voicemail transcript
      l: clip(e.l, 300), // voicemail playback link
    });
    await store.set(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch (err) {
    console.error('call log failed:', err && err.message);
  }
}

async function read() {
  try {
    const raw = await store.get(KEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

module.exports = { log, list: read };
