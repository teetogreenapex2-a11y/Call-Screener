// Tests the voicemail flow and the text-message toggle with a fake settings database and fake Twilio.
// Usage: npm test
process.env.TWILIO_AUTH_TOKEN = 'test_token';
process.env.TWILIO_ACCOUNT_SID = 'ACtest';
process.env.OWNER_PHONE = '+15555550100';
process.env.OWNER_NAME = 'Rick';
process.env.NOTIFY_SMS = '0';
process.env.KV_REST_API_URL = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'kvtoken';
delete process.env.NTFY_TOPIC;
delete process.env.VOICEMAIL_DEFAULT;
delete process.env.SKIP_TWILIO_VALIDATION;

const assert = require('node:assert');
const twilio = require('twilio');
const gather = require('../api/gather');
const dialDone = require('../api/dial-done');
const recording = require('../api/recording');
const transcription = require('../api/transcription');
const listen = require('../api/listen');
const sms = require('../api/sms');
const voice = require('../api/voice');
const contactsApi = require('../api/contacts');
const appApi = require('../api/app');
const whisper = require('../api/whisper');
const adminApi = require('../api/admin');
const voiceToken = require('../api/voice-token');
const provision = require('../lib/provision');
const claude = require('../lib/claude');
const notify = require('../lib/notify');

const HOST = 'screener.example.com';
const REC = 'RE' + 'a1b2c3d4'.repeat(4);
let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('PASS  ' + name);
  } catch (err) {
    failures++;
    console.log('FAIL  ' + name + '\n      ' + (err && err.message));
  }
}

// ---- fakes ----
const db = new Map();
let dbDown = false;
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u === 'https://kv.test') {
    assert.strictEqual(opts.headers.Authorization, 'Bearer kvtoken');
    if (dbDown) return new Response('{"error":"down"}', { status: 500 });
    const [cmd, key, val] = JSON.parse(opts.body);
    if (cmd === 'GET') return new Response(JSON.stringify({ result: db.has(key) ? db.get(key) : null }), { status: 200 });
    if (cmd === 'DEL') {
      const had = db.delete(key);
      return new Response(JSON.stringify({ result: had ? 1 : 0 }), { status: 200 });
    }
    if (cmd === 'SET') {
      db.set(key, val);
      return new Response('{"result":"OK"}', { status: 200 });
    }
    throw new Error('unexpected store command ' + cmd);
  }
  if (u.startsWith('https://api.twilio.com/2010-04-01/Accounts/ACtest/Recordings/')) {
    const expected = 'Basic ' + Buffer.from('ACtest:test_token').toString('base64');
    assert.strictEqual(opts.headers.Authorization, expected, 'recording fetch must use Twilio credentials');
    if (u.includes('RE' + '0'.repeat(32))) return new Response('nope', { status: 404 });
    return new Response(Buffer.from([1, 2, 3, 4]), { status: 200 });
  }
  return realFetch(url, opts);
};

let notices = [];
notify.send = async (n) => {
  notices.push(n);
};

function makeReq(path, body, { sign = true, method = 'POST' } = {}) {
  const headers = { host: HOST, 'x-forwarded-proto': 'https' };
  if (sign && method === 'POST') headers['x-twilio-signature'] = twilio.getExpectedTwilioSignature('test_token', `https://${HOST}${path}`, body);
  return { url: path, headers, body, method };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(b) {
      this.body = b === undefined ? '' : b;
    },
  };
}

async function call(handler, path, body, opts) {
  const res = makeRes();
  await handler(makeReq(path, body, opts), res);
  return res;
}

const unescape = (s) => s.replace(/&amp;/g, '&');

// Run gather with a stubbed "ring" decision and return the follow-up URL from the <Dial>.
async function ringAndGetDialAction() {
  claude.decide = async () => ({ action: 'ring', say: '', summary: 'Mike about his order.', category: 'legit' });
  const res = await call(gather, '/api/gather?r=0', { SpeechResult: "Mike, about my order", From: '+13035550123' });
  const m = res.body.match(/<Dial[^>]*action="([^"]+)"/);
  assert(m, 'Dial must have an action URL');
  assert.match(res.body, /timeout="18"/, 'rings 18 seconds so ours beats the carrier voicemail');
  return unescape(m[1]);
}

(async () => {
  await test('ring-through hands off to /api/dial-done with caller details', async () => {
    notices = [];
    const action = await ringAndGetDialAction();
    assert.match(action, /^\/api\/dial-done\?i=/);
  });

  await test('answered call: nothing more happens', async () => {
    notices = [];
    const action = await ringAndGetDialAction();
    notices = [];
    const res = await call(dialDone, action, { DialCallStatus: 'completed', From: '+13035550123' });
    assert.match(res.body, /<Hangup/);
    assert.doesNotMatch(res.body, /<Record/);
    assert.strictEqual(notices.length, 0);
  });

  await test('not answered + voicemail OFF (default): polite goodbye and a missed-call notice', async () => {
    db.clear();
    const action = await ringAndGetDialAction();
    notices = [];
    const res = await call(dialDone, action, { DialCallStatus: 'no-answer', From: '+13035550123' });
    assert.match(res.body, /isn(&apos;|')t available right now/);
    assert.match(res.body, /<Hangup/);
    assert.doesNotMatch(res.body, /<Record/);
    assert.strictEqual(notices[0].title, 'Missed call');
    assert.match(notices[0].body, /Mike about his order.*\+13035550123/);
  });

  await test('not answered + voicemail ON: records with transcription and callbacks', async () => {
    db.set('voicemail_enabled', '1');
    const action = await ringAndGetDialAction();
    for (const status of ['no-answer', 'busy', 'failed']) {
      const res = await call(dialDone, action, { DialCallStatus: status, From: '+13035550123' });
      assert.match(res.body, /<Record/, status);
      assert.match(res.body, /transcribe="true"/);
      assert.match(res.body, /recordingStatusCallback="\/api\/recording\?i=/);
      assert.match(res.body, /transcribeCallback="\/api\/transcription\?i=/);
      assert.match(res.body, /recorded and transcribed/);
    }
  });

  await test('caller hangs up while ringing: missed-call notice, no voicemail prompt', async () => {
    db.set('voicemail_enabled', '1');
    const action = await ringAndGetDialAction();
    notices = [];
    const res = await call(dialDone, action, { DialCallStatus: 'canceled', From: '+13035550123' });
    assert.doesNotMatch(res.body, /<Record/);
    assert.match(notices[0].body, /hung up while ringing/);
  });

  await test('voicemail setting falls back to the default if the database is down', async () => {
    db.set('voicemail_enabled', '1');
    dbDown = true;
    const action = await ringAndGetDialAction();
    const res = await call(dialDone, action, { DialCallStatus: 'no-answer', From: '+1' });
    dbDown = false;
    assert.doesNotMatch(res.body, /<Record/);
    assert.match(res.body, /<Hangup/);
  });

  // ---- recording / transcription callbacks ----
  const info = require('../lib/twiml').encodeInfo({ s: 'Mike about his order.', c: 'legit', f: '+13035550123' });
  const recPath = `/api/recording?i=${info}`;
  const trPath = `/api/transcription?i=${info}`;

  await test('recording callback: empty message is reported, real message waits for the transcript', async () => {
    notices = [];
    await call(recording, recPath, { RecordingStatus: 'completed', RecordingDuration: '0', RecordingSid: REC });
    assert.match(notices[0].body, /left no message/);

    notices = [];
    await call(recording, recPath, { RecordingStatus: 'completed', RecordingDuration: '30', RecordingSid: REC });
    assert.strictEqual(notices.length, 0, 'long messages are announced by the transcription callback');

    notices = [];
    await call(recording, recPath, { RecordingStatus: 'completed', RecordingDuration: '2', RecordingSid: REC });
    assert.match(notices[0].body, /Very short voicemail.*\/api\/listen\?r=/);

    notices = [];
    await call(recording, recPath, { RecordingStatus: 'failed', RecordingDuration: '0', RecordingSid: REC });
    assert.strictEqual(notices[0].title, 'Voicemail failed');
  });

  let listenPath;
  await test('transcription callback: notice has caller, the words, and a playable link', async () => {
    notices = [];
    const res = await call(transcription, trPath, {
      TranscriptionStatus: 'completed',
      TranscriptionText: 'Hey Rick, it is Mike, call me back about the launch monitor.',
      RecordingSid: REC,
    });
    assert.strictEqual(res.statusCode, 200);
    const n = notices[0];
    assert.strictEqual(n.title, 'New voicemail');
    assert.strictEqual(n.max, 600);
    assert.match(n.body, /\+13035550123/);
    assert.match(n.body, /call me back about the launch monitor/);
    const link = n.body.match(/https:\/\/screener\.example\.com(\/api\/listen\?r=\w+&k=[0-9a-f]+)/);
    assert(link, 'notice must include a listen link');
    listenPath = link[1];
  });

  await test('transcription failure still delivers the link', async () => {
    notices = [];
    await call(transcription, trPath, { TranscriptionStatus: 'failed', RecordingSid: REC });
    assert.match(notices[0].body, /Transcript unavailable/);
    assert.match(notices[0].body, /\/api\/listen\?r=/);
  });

  await test('listen: signed link plays the audio; forged or edited links are refused', async () => {
    let res = makeRes();
    await listen(makeReq(listenPath, {}, { method: 'GET' }), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'audio/mpeg');
    assert.deepStrictEqual([...res.body], [1, 2, 3, 4]);

    res = makeRes();
    await listen(makeReq(listenPath.replace(/k=[0-9a-f]/, 'k=0'), {}, { method: 'GET' }), res);
    assert.strictEqual(res.statusCode, 403);

    res = makeRes();
    await listen(makeReq(`/api/listen?r=${REC}`, {}, { method: 'GET' }), res);
    assert.strictEqual(res.statusCode, 403);

    res = makeRes();
    await listen(makeReq(`/api/listen?r=${'RE' + 'b'.repeat(32)}&k=${require('../lib/links').sign('RE' + 'c'.repeat(32))}`, {}, { method: 'GET' }), res);
    assert.strictEqual(res.statusCode, 403, 'a signature for one recording must not unlock another');
  });

  await test('listen: deleted recording gives a clear 404', async () => {
    const gone = 'RE' + '0'.repeat(32);
    const link = `/api/listen?r=${gone}&k=${require('../lib/links').sign(gone)}`;
    const res = makeRes();
    await listen(makeReq(link, {}, { method: 'GET' }), res);
    assert.strictEqual(res.statusCode, 404);
  });

  // ---- text-message toggle ----
  const OWNER = { From: '+1 (555) 555-0100' };

  await test('sms: with NOTIFY_SMS=0 the app sends no text of its own; the setting still changes and push confirms', async () => {
    process.env.NOTIFY_SMS = '0';
    db.clear();
    notices = [];
    const res = await call(sms, '/api/sms', { ...OWNER, Body: 'VM ON' });
    process.env.NOTIFY_SMS = '1';
    assert.strictEqual(db.get('voicemail_enabled'), '1');
    assert.doesNotMatch(res.body, /<Message/, 'no text reply on a shared or unregistered number');
    assert.match(notices[0].body, /Voicemail is now ON\./);
  });

  process.env.NOTIFY_SMS = '1'; // the remaining sms tests cover the normal (text reply) behavior; notifications are faked here

  await test('sms: VM ON and VM OFF from your phone change the setting', async () => {
    db.clear();
    notices = [];
    let res = await call(sms, '/api/sms', { ...OWNER, Body: 'VM ON' });
    assert.strictEqual(db.get('voicemail_enabled'), '1');
    assert.match(res.body, /Voicemail is now ON\./);
    assert.strictEqual(notices[0].sms, false, 'confirmation goes by push, texts can be filtered');

    res = await call(sms, '/api/sms', { ...OWNER, Body: '  vm   off ' });
    assert.strictEqual(db.get('voicemail_enabled'), '0');
    assert.match(res.body, /Voicemail is now OFF\./);

    res = await call(sms, '/api/sms', { ...OWNER, Body: 'Voicemail on' });
    assert.strictEqual(db.get('voicemail_enabled'), '1');
  });

  await test('sms: "VM" reports the current setting', async () => {
    db.set('voicemail_enabled', '1');
    let res = await call(sms, '/api/sms', { ...OWNER, Body: 'vm' });
    assert.match(res.body, /Voicemail is ON\./);
    db.set('voicemail_enabled', '0');
    res = await call(sms, '/api/sms', { ...OWNER, Body: 'VM status' });
    assert.match(res.body, /Voicemail is OFF\./);
  });

  await test('sms: texts from anyone else are ignored', async () => {
    db.set('voicemail_enabled', '0');
    notices = [];
    const res = await call(sms, '/api/sms', { From: '+19995550000', Body: 'VM ON' });
    assert.strictEqual(db.get('voicemail_enabled'), '0');
    assert.doesNotMatch(res.body, /<Message/);
    assert.strictEqual(notices.length, 0);
  });

  await test('sms: unknown text gets a hint and changes nothing', async () => {
    db.set('voicemail_enabled', '0');
    const res = await call(sms, '/api/sms', { ...OWNER, Body: 'hello?' });
    assert.match(res.body, /Text VM ON or VM OFF/);
    assert.strictEqual(db.get('voicemail_enabled'), '0');
  });

  await test('sms: says so if the settings database is not connected', async () => {
    const saved = [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN];
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const res = await call(sms, '/api/sms', { ...OWNER, Body: 'VM ON' });
    [process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN] = saved;
    assert.match(res.body, /database isn(&apos;|')t connected/);
  });

  await test('sms: reports a failed save instead of pretending it worked', async () => {
    dbDown = true;
    const res = await call(sms, '/api/sms', { ...OWNER, Body: 'VM ON' });
    dbDown = false;
    assert.match(res.body, /Couldn(&apos;|')t save/);
  });

  await test('new endpoints reject requests that are not signed by Twilio', async () => {
    for (const [handler, path] of [
      [dialDone, '/api/dial-done'],
      [recording, '/api/recording'],
      [transcription, '/api/transcription'],
      [sms, '/api/sms'],
    ]) {
      const res = await call(handler, path, { From: OWNER.From, Body: 'VM ON' }, { sign: false });
      assert.strictEqual(res.statusCode, 403, path);
    }
  });

  // ---- ring-through contacts ----
  process.env.ADMIN_KEY = 'adminkey12345';
  const getPage = async (key) => {
    const res = makeRes();
    await contactsApi({ url: '/api/contacts?key=' + key, headers: {}, method: 'GET' }, res);
    return res;
  };
  const postList = async (key, body) => {
    const res = makeRes();
    await contactsApi({ url: '/api/contacts?key=' + key, headers: {}, method: 'POST', body }, res);
    return res;
  };

  await test('contacts page: wrong or missing key is refused', async () => {
    assert.strictEqual((await getPage('nope')).statusCode, 403);
    assert.strictEqual((await getPage('')).statusCode, 403);
  });

  await test('contacts page: saves numbers (merging by default, replace on request)', async () => {
    db.clear();
    let res = await postList('adminkey12345', { numbers: ['(919) 555-0001', '+1 919 555 0002', 'junk'] });
    assert.strictEqual(JSON.parse(res.body).count, 2);
    res = await postList('adminkey12345', { numbers: ['9195550003', '9195550001'] });
    assert.strictEqual(JSON.parse(res.body).count, 3);
    res = await postList('adminkey12345', { numbers: ['9195550009'], replace: true });
    assert.strictEqual(JSON.parse(res.body).count, 1);
    assert.match((await getPage('adminkey12345')).body, /<b id="n">1<\/b>/);
  });

  await test('voice: a saved contact rings straight through, others are screened', async () => {
    db.clear();
    await postList('adminkey12345', { numbers: ['9195550001'] });
    notices = [];
    let res = await call(voice, '/api/voice', { From: '+19195550001' });
    assert.match(res.body, /<Dial/);
    assert.match(res.body, /\+15555550100/);
    assert.doesNotMatch(res.body, /<Gather/);
    assert.match(notices[0].body, /contact/);
    res = await call(voice, '/api/voice', { From: '+19195557777' });
    assert.match(res.body, /<Gather/);
    assert.doesNotMatch(res.body, /<Dial/);
  });

  await test('voice: a contact number that failed caller-ID verification is still screened', async () => {
    const res = await call(voice, "/api/voice", { From: "+19195550001", StirVerstat: 'TN-Validation-Failed-A' });
    assert.match(res.body, /<Gather/);
  });

  await test('voice: if the database is down, the call is screened as usual', async () => {
    dbDown = true;
    const res = await call(voice, '/api/voice', { From: '+19195550001' });
    dbDown = false;
    assert.match(res.body, /<Gather/);
  });

  await test('sms: ALLOW and UNALLOW edit the list; strangers cannot', async () => {
    db.clear();
    let res = await call(sms, '/api/sms', { ...OWNER, Body: 'ALLOW 919-555-1234' });
    assert.match(res.body, /Added 9195551234\. 1 numbers/);
    assert.strictEqual((await call(voice, '/api/voice', { From: '+19195551234' })).body.includes('<Dial'), true);
    res = await call(sms, '/api/sms', { ...OWNER, Body: 'unallow 9195551234' });
    assert.match(res.body, /Removed 9195551234\. 0 numbers/);
    assert.strictEqual((await call(voice, '/api/voice', { From: '+19195551234' })).body.includes('<Dial'), false);
    res = await call(sms, '/api/sms', { From: '+19195559999', Body: 'ALLOW 9195551234' });
    assert.doesNotMatch(res.body, /Added/);
    assert.strictEqual((await call(voice, '/api/voice', { From: '+19195551234' })).body.includes('<Dial'), false);
  });

  // ---- phone app ----
  const appCall = async (key, body) => {
    const res = makeRes();
    await appApi({ url: '/api/app', headers: key ? { 'x-admin-key': key } : {}, method: body ? 'POST' : 'GET', body }, res);
    return res;
  };

  await test('app: refuses requests without the right key', async () => {
    assert.strictEqual((await appCall('', null)).statusCode, 403);
    assert.strictEqual((await appCall('wrong', null)).statusCode, 403);
  });

  await test('app: voicemail switch and contacts work from the app', async () => {
    db.clear();
    let d = JSON.parse((await appCall('adminkey12345', { action: 'voicemail', on: true })).body);
    assert.strictEqual(d.voicemail, true);
    d = JSON.parse((await appCall('adminkey12345', { action: 'import', numbers: ['9195550001', '9195550002'] })).body);
    assert.strictEqual(d.contacts, 2);
    d = JSON.parse((await appCall('adminkey12345', { action: 'unallow', number: '(919) 555-0001' })).body);
    assert.strictEqual(d.contacts, 1);
    d = JSON.parse((await appCall('adminkey12345', { action: 'voicemail', on: false })).body);
    assert.strictEqual(d.voicemail, false);
  });

  await test('app: call list records blocked calls, missed calls and voicemails', async () => {
    db.clear();
    claude.decide = async () => ({ action: 'reject', say: '', summary: 'Solar panel sales.', category: 'sales' });
    await call(gather, '/api/gather?r=0', { SpeechResult: 'solar panels', From: '+13035550111' });
    const action = await ringAndGetDialAction();
    await call(dialDone, action, { DialCallStatus: 'no-answer', From: '+13035550123' });
    await call(dialDone, action, { DialCallStatus: 'completed', From: '+13035550123' });
    await call(transcription, '/api/transcription?i=' + action.split('i=')[1], {
      TranscriptionStatus: 'completed', TranscriptionText: 'Call me back', RecordingSid: REC,
    });
    const d = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.deepStrictEqual(d.calls.map((c) => c.o), ['voicemail', 'answered', 'missed', 'blocked']);
    assert.strictEqual(d.calls[0].v, 'Call me back');
    assert.match(d.calls[0].l, /^https:\/\/.*\/api\/listen\?r=RE/);
    assert.match(d.calls[3].s, /Solar/);
  });

  await test('app: a broken database never breaks a call', async () => {
    dbDown = true;
    claude.decide = async () => ({ action: 'reject', say: '', summary: 'Spam.', category: 'scam' });
    const res = await call(gather, '/api/gather?r=0', { SpeechResult: 'hi', From: '+13035550111' });
    dbDown = false;
    assert.match(res.body, /<Hangup/);
  });

  // ---- whisper (hear who is calling, press 1) ----
  await test('whisper: you hear who is calling and can press 1 or 2', async () => {
    const action = await ringAndGetDialAction();
    const i = action.split('i=')[1];
    const dialXml = (await call(gather, '/api/gather?r=0', { SpeechResult: 'Mike', From: '+13035550123' })).body;
    assert.match(dialXml, /<Number[^>]*url="\/api\/whisper\?i=/);
    const res = await call(whisper, '/api/whisper?i=' + i, { CallSid: 'CAchild', ParentCallSid: 'CAparent' });
    assert.match(res.body, /<Gather[^>]*numDigits="1"/);
    assert.match(res.body, /Mike about his order/);
    assert.match(res.body, /Press 1 to accept/);
    assert.match(res.body, /\/api\/whisper\?i=[^"]*&amp;no=1/, 'no input falls through to decline');
  });

  await test('whisper: pressing 1 connects the caller (empty response)', async () => {
    const res = await call(whisper, '/api/whisper?i=x', { Digits: '1', ParentCallSid: 'CAp1' });
    assert.doesNotMatch(res.body, /<Hangup|<Gather|<Say/);
  });

  await test('whisper: pressing 2 declines; the caller gets the voicemail path, not a hangup', async () => {
    db.clear();
    const action = await ringAndGetDialAction();
    const i = action.split('i=')[1];
    let res = await call(whisper, '/api/whisper?i=' + i, { Digits: '2', ParentCallSid: 'CAp2', CallSid: 'CAc2' });
    assert.match(res.body, /<Hangup/);
    // voicemail off: polite message
    res = await call(dialDone, action, { DialCallStatus: 'completed', CallSid: 'CAp2' });
    assert.match(res.body, /isn(&apos;|')t available right now/);
    assert.doesNotMatch(res.body, /<Record/);
    // voicemail on: offered a message
    await call(sms, '/api/sms', { ...OWNER, Body: 'VM ON' });
    await call(whisper, '/api/whisper?i=' + i + '&no=1', { ParentCallSid: 'CAp3' });
    res = await call(dialDone, action, { DialCallStatus: 'completed', CallSid: 'CAp3' });
    assert.match(res.body, /<Record/);
  });

  await test('whisper: a normal answered call (not declined) just ends', async () => {
    const action = await ringAndGetDialAction();
    const res = await call(dialDone, action, { DialCallStatus: 'completed', CallSid: 'CAnever' });
    assert.doesNotMatch(res.body, /<Record|isn(&apos;|')t available/);
  });

  await test('whisper: rejects requests without a valid Twilio signature', async () => {
    const res = await call(whisper, '/api/whisper?i=x', { Digits: '1' }, { sign: false });
    assert.strictEqual(res.statusCode, 403);
  });

  // ---- multiple customers ----
  let bought = 0;
  let released = [];
  provision.buy = async ({ areaCode, host }) => {
    bought++;
    assert.strictEqual(host, HOST);
    return { number: `+1${areaCode || '919'}5550${100 + bought}`, sid: 'PN' + String(bought).padStart(32, '0') };
  };
  provision.release = async (sid) => {
    released.push(sid);
  };
  const adminCall = async (key, body) => {
    const res = makeRes();
    await adminApi({ url: '/api/admin', headers: { host: HOST, ...(key ? { 'x-admin-key': key } : {}) }, method: body ? 'POST' : 'GET', body }, res);
    return res;
  };
  const tokenOf = (link) => link.split('key=')[1];
  let mike; // { id, number, token }

  await test('admin: only your key can add customers', async () => {
    assert.strictEqual((await adminCall('', null)).statusCode, 403);
    assert.strictEqual((await adminCall('adminkey12345wrong', { action: 'create', name: 'X', cell: '9195550000' })).statusCode, 403);
  });

  await test('admin: adding a customer buys a number and returns a private link', async () => {
    db.clear();
    const r = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: 'Mike', cell: '(704) 555-0188', areaCode: '704' })).body);
    assert.strictEqual(r.created.name, 'Mike');
    assert.strictEqual(r.created.cell, '+17045550188');
    assert.match(r.created.number, /^\+1704/);
    assert.match(r.link, new RegExp('^https://' + HOST + '/\\?key='));
    assert.strictEqual(r.users.length, 1);
    assert.ok(!JSON.stringify(r.users).includes('ntfy'), 'list must not expose push topics or tokens');
    mike = { id: r.created.id, number: r.created.number, token: tokenOf(r.link) };
    await test('admin: missing name or cell is refused without buying a number', async () => {
      const before = bought;
      const bad = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: '', cell: '7045550188' })).body);
      assert.match(bad.error, /name/i);
      assert.strictEqual(bought, before);
    });
  });

  await test("customer's app: own link works, wrong link does not, and the data is separate from yours", async () => {
    await call(sms, '/api/sms', { ...OWNER, Body: 'VM ON' }); // owner turns voicemail on
    const bad = await appCall('not-a-real-key', null);
    assert.strictEqual(bad.statusCode, 403);
    let d = JSON.parse((await appCall(mike.token, null)).body);
    assert.strictEqual(d.voicemail, false, "your setting must not leak to the customer");
    assert.strictEqual(d.me.number, mike.number);
    assert.match(d.me.ntfy, /^screener-/);
    d = JSON.parse((await appCall(mike.token, { action: 'voicemail', on: true })).body);
    assert.strictEqual(d.voicemail, true);
    d = JSON.parse((await appCall(mike.token, { action: 'import', numbers: ['9195559001', '9195559002', '9195559003'] })).body);
    assert.strictEqual(d.contacts, 3);
    const mine = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.notStrictEqual(mine.contacts, 3);
    await appCall(mike.token, { action: 'voicemail', on: false });
    assert.strictEqual(JSON.parse((await appCall('adminkey12345', null)).body).voicemail, true, "customer cannot change yours");
  });

  await test("calls to a customer's number are greeted for them and ring their cell, not yours", async () => {
    notices = [];
    const g = await call(voice, '/api/voice', { From: '+19195557777', To: mike.number });
    assert.match(g.body, /AI call assistant for Mike/);
    assert.match(g.body, new RegExp('/api/gather\\?r=0[^"]*&amp;u=' + mike.id));
    claude.decide = async ({ t }) => {
      assert.strictEqual(t.id, mike.id, 'screening uses the customer');
      return { action: 'ring', say: '', summary: 'Neighbor about the fence.', category: 'legit' };
    };
    const url = unescape(g.body.match(/action="(\/api\/gather[^"]+)"/)[1]);
    const r = await call(gather, url, { SpeechResult: 'my fence', From: '+19195557777', To: mike.number });
    assert.match(r.body, /\+17045550188/);
    assert.doesNotMatch(r.body, /\+15555550100/);
    assert.match(r.body, /Number[^>]*url="\/api\/whisper\?i=/);
    assert.strictEqual(notices.at(-1).topic.startsWith('screener-'), true, 'alerts go to their push topic');
    assert.strictEqual(notices.at(-1).sms, false, 'never texts from your number');
  });

  await test("a customer's missed call, decline and voicemail land in their list only", async () => {
    claude.decide = async () => ({ action: 'ring', say: '', summary: 'Neighbor about the fence.', category: 'legit' });
    const url = '/api/gather?r=0&u=' + mike.id;
    const r = await call(gather, url, { SpeechResult: 'fence', From: '+19195557777', To: mike.number });
    const action = unescape(r.body.match(/<Dial[^>]*action="([^"]+)"/)[1]);
    assert.match(action, /\?i=/);
    // voicemail off for Mike: polite goodbye, no recording
    let res = await call(dialDone, action, { DialCallStatus: 'no-answer', CallSid: 'CAm1' });
    assert.match(res.body, /Mike isn(&apos;|')t available/);
    assert.doesNotMatch(res.body, /<Record/);
    // voicemail on for Mike: records
    await call(sms, '/api/sms', { From: '+17045550188', To: mike.number, Body: 'vm on' });
    res = await call(dialDone, action, { DialCallStatus: 'no-answer', CallSid: 'CAm2' });
    assert.match(res.body, /<Record/);
    await call(transcription, '/api/transcription?i=' + action.split('i=')[1], {
      TranscriptionStatus: 'completed', TranscriptionText: 'Your fence is down', RecordingSid: REC,
    });
    const mine = JSON.parse((await appCall(mike.token, null)).body);
    assert.deepStrictEqual(mine.calls.map((c) => c.o), ['voicemail', 'missed']);
    assert.strictEqual(mine.calls[0].v, 'Your fence is down');
    const yours = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.ok(!yours.calls.some((c) => /fence/i.test(c.s)), 'your list never shows their calls');
  });

  await test("texts to a customer's number: only their cell works, and nothing is texted back", async () => {
    let res = await call(sms, '/api/sms', { From: '+17045550188', To: mike.number, Body: 'VM OFF' });
    assert.doesNotMatch(res.body, /<Message/);
    assert.strictEqual(JSON.parse((await appCall(mike.token, null)).body).voicemail, false);
    res = await call(sms, '/api/sms', { From: OWNER.From, To: mike.number, Body: 'VM ON' });
    assert.strictEqual(JSON.parse((await appCall(mike.token, null)).body).voicemail, false, "even your phone cannot change a customer's setting by text");
    res = await call(sms, '/api/sms', { From: '+17045550188', To: mike.number, Body: 'ALLOW 9195551111' });
    assert.strictEqual(JSON.parse((await appCall(mike.token, null)).body).contacts, 4);
  });

  await test("a customer's saved contact rings straight through to their cell", async () => {
    const res = await call(voice, '/api/voice', { From: '+19195559001', To: mike.number });
    assert.match(res.body, /<Dial/);
    assert.match(res.body, /\+17045550188/);
    assert.doesNotMatch(res.body, /<Number[^>]*url=/);
  });

  await test('your own number still works exactly as before', async () => {
    const res = await call(voice, '/api/voice', { From: '+19195557777', To: '+19195559999' });
    assert.match(res.body, /AI call assistant for Rick/);
    assert.doesNotMatch(res.body, /&amp;u=/);
  });

  await test('admin: a new login link replaces the old one, and removing a customer releases the number', async () => {
    const r = JSON.parse((await adminCall('adminkey12345', { action: 'newlink', id: mike.id })).body);
    assert.notStrictEqual(tokenOf(r.link), mike.token);
    assert.strictEqual((await appCall(tokenOf(r.link), null)).statusCode, 200);
    assert.strictEqual((await appCall(mike.token, null)).statusCode, 403, 'the old link no longer works');
    const del = JSON.parse((await adminCall('adminkey12345', { action: 'delete', id: mike.id })).body);
    assert.strictEqual(del.users.length, 0);
    assert.deepStrictEqual(released, ['PN' + '1'.padStart(32, '0')]);
    assert.strictEqual((await appCall(tokenOf(r.link), null)).statusCode, 403, 'a removed customer cannot log in');
    const after = await call(voice, '/api/voice', { From: '+19195557777', To: mike.number });
    assert.match(after.body, /AI call assistant for Rick/, 'a removed number no longer routes to the customer');
  });

  await test('admin: if saving fails after buying a number, the number is released', async () => {
    released = [];
    dbDown = true;
    const r = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: 'Pat', cell: '9195550101' })).body);
    dbDown = false;
    assert.ok(r.error);
    assert.strictEqual(released.length, 1);
  });

  // ---- contact names ----
  await test('contact names: imported names show on calls from those numbers (and removing the contact removes the name)', async () => {
    db.clear();
    await appCall('adminkey12345', { action: 'import', entries: [{ n: '(919) 555-1234', name: 'Mike  Smith' }, { n: '9195552222' }, { n: 'junk', name: 'Nobody' }] });
    claude.decide = async () => ({ action: 'reject', say: '', summary: 'Sales pitch.', category: 'sales' });
    await call(gather, '/api/gather?r=0', { SpeechResult: 'hello', From: '+19195551234' });
    await call(gather, '/api/gather?r=0', { SpeechResult: 'hello', From: '+19195552222' });
    await call(gather, '/api/gather?r=0', { SpeechResult: 'hello', From: '+19195553333' });
    let d = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.strictEqual(d.contacts, 2);
    const byFrom = Object.fromEntries(d.calls.map((c) => [c.f, c.name]));
    assert.strictEqual(byFrom['+19195551234'], 'Mike Smith');
    assert.strictEqual(byFrom['+19195552222'], '');
    assert.strictEqual(byFrom['+19195553333'], '');
    d = JSON.parse((await appCall('adminkey12345', { action: 'unallow', number: '9195551234' })).body);
    assert.strictEqual(d.calls.find((c) => c.f === '+19195551234').name, '');
  });

  await test('contact names: replacing the list clears old names; plain number imports still work', async () => {
    await appCall('adminkey12345', { action: 'import', entries: [{ n: '9195551234', name: 'Mike' }] });
    await appCall('adminkey12345', { action: 'import', numbers: ['9195559999'], replace: true });
    const d = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.strictEqual(d.contacts, 1);
    assert.ok(d.calls.every((c) => !c.name));
  });

  await test("contact names: a customer's names are separate from yours", async () => {
    const r = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: 'Lee', cell: '9195550177' })).body);
    const tok = r.link.split('key=')[1];
    await appCall(tok, { action: 'import', entries: [{ n: '9195551234', name: 'Lee Friend' }] });
    claude.decide = async () => ({ action: 'reject', say: '', summary: 'Sales.', category: 'sales' });
    await call(gather, '/api/gather?r=0&u=' + r.created.id, { SpeechResult: 'hi', From: '+19195551234' });
    const theirs = JSON.parse((await appCall(tok, null)).body);
    assert.strictEqual(theirs.calls[0].name, 'Lee Friend');
    const mine = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.ok(mine.calls.every((c) => c.name !== 'Lee Friend'));
  });

  // ---- contact list screen and last-synced ----
  await test('contacts screen: list is sorted by name, names first; last-synced is recorded on import', async () => {
    db.clear();
    let d = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.strictEqual(d.synced, 0, 'never synced yet');
    await appCall('adminkey12345', { action: 'import', entries: [{ n: '9195550003' }, { n: '9195550002', name: 'Zed' }, { n: '9195550001', name: 'Amy' }, { n: '9195550000' }] });
    d = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.ok(Date.now() - d.synced < 5000, 'synced time is set');
    const list = JSON.parse((await appCall('adminkey12345', { action: 'contacts' })).body).contactList;
    assert.deepStrictEqual(list.map((c) => c.name || c.n), ['Amy', 'Zed', '9195550000', '9195550003']);
  });

  await test('contacts screen: customers only see their own list, and need their own key', async () => {
    const r = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: 'Kay', cell: '9195550166' })).body);
    const tok = r.link.split('key=')[1];
    await appCall(tok, { action: 'import', entries: [{ n: '9195557001', name: 'Kay Friend' }] });
    const theirs = JSON.parse((await appCall(tok, { action: 'contacts' })).body).contactList;
    assert.deepStrictEqual(theirs.map((c) => c.name), ['Kay Friend']);
    assert.strictEqual((await appCall('bad-key', { action: 'contacts' })).statusCode, 403);
    const mine = JSON.parse((await appCall('adminkey12345', { action: 'contacts' })).body).contactList;
    assert.ok(!mine.some((c) => c.name === 'Kay Friend'));
  });

  // ---- ringing the Android app ----
  const tokenCall = async (key) => {
    const res = makeRes();
    await voiceToken({ url: '/api/voice-token', headers: key ? { 'x-admin-key': key } : {}, method: 'GET' }, res);
    return res;
  };
  const ringXml = async (from, u) => {
    claude.decide = async () => ({ action: 'ring', say: '', summary: 'Neighbor about the fence.', category: 'legit' });
    return (await call(gather, '/api/gather?r=0' + (u ? '&u=' + u : ''), { SpeechResult: 'fence', From: from })).body;
  };

  await test('app calling: ring mode defaults to the phone number; app and both modes add the app as a target', async () => {
    db.clear();
    let x = await ringXml('+19195551234');
    assert.match(x, /<Number/);
    assert.doesNotMatch(x, /<Client/);
    await appCall('adminkey12345', { action: 'ringmode', mode: 'app' });
    x = await ringXml('+19195551234');
    assert.doesNotMatch(x, /<Number/);
    assert.match(x, /<Client><Identity>owner<\/Identity>/);
    assert.match(x, /<Parameter name="summary" value="Neighbor about the fence\."/);
    assert.match(x, /<Parameter name="from" value="\+19195551234"/);
    await appCall('adminkey12345', { action: 'ringmode', mode: 'both' });
    x = await ringXml('+19195551234');
    assert.match(x, /<Number/);
    assert.match(x, /<Client>/);
    assert.match(x, /action="\/api\/dial-done\?i=/);
    const bad = await appCall('adminkey12345', { action: 'ringmode', mode: 'nonsense' });
    assert.strictEqual(bad.statusCode, 400);
  });

  await test("app calling: the caller's saved name is passed to the app's call screen", async () => {
    await appCall('adminkey12345', { action: 'import', entries: [{ n: '9195551234', name: 'Mike Smith' }] });
    const x = await ringXml('+19195551234');
    assert.match(x, /<Parameter name="name" value="Mike Smith"/);
  });

  await test('app calling: saved contacts ring the app too, with no whisper', async () => {
    const res = await call(voice, '/api/voice', { From: '+19195551234' });
    assert.match(res.body, /<Client>/);
    assert.doesNotMatch(res.body, /whisper/);
  });

  await test("app calling: a customer's app is addressed by their own name and never yours", async () => {
    const r = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: 'Jo', cell: '9195550155' })).body);
    await appCall(r.link.split('key=')[1], { action: 'ringmode', mode: 'app' });
    const x = await ringXml('+19195557000', r.created.id);
    assert.match(x, new RegExp('<Identity>u' + r.created.id + '</Identity>'));
    assert.doesNotMatch(x, /<Identity>owner/);
  });

  await test('app calling: a declined or unreachable app falls into the normal voicemail path', async () => {
    db.clear();
    await appCall('adminkey12345', { action: 'ringmode', mode: 'app' });
    const x = await ringXml('+19195551234');
    const action = unescape(x.match(/<Dial[^>]*action="([^"]+)"/)[1]);
    const res = await call(dialDone, action, { DialCallStatus: 'busy', CallSid: 'CAapp1' });
    assert.match(res.body, /isn(&apos;|')t available right now/);
  });

  await test('voice token: refuses without a key, explains missing server setup, then issues a token', async () => {
    assert.strictEqual((await tokenCall('')).statusCode, 403);
    assert.strictEqual((await tokenCall('nope')).statusCode, 403);
    for (const k of ['TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_PUSH_CREDENTIAL_SID']) delete process.env[k];
    let r = JSON.parse((await tokenCall('adminkey12345')).body);
    assert.match(r.error, /TWILIO_API_KEY_SID/);
    process.env.TWILIO_API_KEY_SID = 'SK' + 'a'.repeat(32);
    process.env.TWILIO_API_KEY_SECRET = 'secret';
    process.env.TWILIO_PUSH_CREDENTIAL_SID = 'CR' + 'b'.repeat(32);
    db.clear();
    r = JSON.parse((await tokenCall('adminkey12345')).body);
    assert.strictEqual(r.identity, 'owner');
    const claims = JSON.parse(Buffer.from(r.token.split('.')[1], 'base64url').toString());
    assert.strictEqual(claims.grants.identity, 'owner');
    assert.strictEqual(claims.grants.voice.incoming.allow, true);
    assert.strictEqual(claims.grants.voice.push_credential_sid, 'CR' + 'b'.repeat(32));
    assert.strictEqual(r.mode, 'app', 'first registration switches ringing to the app');
  });

  await test('voice token: registering again never overrides the ring mode you chose', async () => {
    await appCall('adminkey12345', { action: 'ringmode', mode: 'both' });
    const r = JSON.parse((await tokenCall('adminkey12345')).body);
    assert.strictEqual(r.mode, 'both');
  });

  await test("voice token: a customer gets a token for their own identity only", async () => {
    const c = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: 'Al', cell: '9195550144' })).body);
    const r = JSON.parse((await tokenCall(c.link.split('key=')[1])).body);
    assert.strictEqual(r.identity, 'u' + c.created.id);
  });

  await test('removed contacts stay removed when the phone syncs again, and come back when added by hand', async () => {
    db.clear();
    await appCall('adminkey12345', { action: 'import', entries: [{ n: '9195550001', name: 'Ann' }, { n: '9195550002', name: 'Bob' }] });
    await appCall('adminkey12345', { action: 'unallow', number: '9195550001' });
    let d = JSON.parse((await appCall('adminkey12345', { action: 'import', skipRemoved: true, entries: [{ n: '9195550001', name: 'Ann' }, { n: '9195550002', name: 'Bob' }, { n: '9195550003', name: 'Cy' }] })).body);
    assert.strictEqual(d.contacts, 2, 'Ann stays out, Cy is added');
    d = JSON.parse((await appCall('adminkey12345', { action: 'allow', number: '9195550001' })).body);
    assert.strictEqual(d.contacts, 3);
    d = JSON.parse((await appCall('adminkey12345', { action: 'import', skipRemoved: true, entries: [{ n: '9195550001' }] })).body);
    assert.strictEqual(d.contacts, 3, 'adding by hand clears the removed mark');
  });

  await test('ring time: default, change, limits, and it is used when ringing', async () => {
    db.clear();
    let d = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.strictEqual(d.ringSeconds, 18);
    d = JSON.parse((await appCall('adminkey12345', { action: 'ringseconds', seconds: 30 })).body);
    assert.strictEqual(d.ringSeconds, 30);
    assert.strictEqual((await appCall('adminkey12345', { action: 'ringseconds', seconds: 3 })).statusCode, 400);
    const x = await ringXml('+19195551234');
    assert.match(x, /timeout="30"/);
    assert.match(x, /timeLimit="5400"/);
  });

  await test('usage cap: customers are stopped at their monthly limit and you are told once', async () => {
    db.clear();
    process.env.CUSTOMER_MONTHLY_CALLS = '2';
    const notes = [];
    const realSend = notify.send;
    notify.send = async (o) => { notes.push(o.title); };
    try {
      const r = JSON.parse((await adminCall('adminkey12345', { action: 'create', name: 'Cap', cell: '9195550166' })).body);
      const to = r.created.number;
      const dial = () => call(voice, '/api/voice', { From: '+19195559999', To: to });
      assert.match((await dial()).body, /<Gather/);
      assert.match((await dial()).body, /<Gather/);
      const over = await dial();
      assert.match(over.body, /isn(&apos;|')t available right now/);
      assert.doesNotMatch(over.body, /<Gather/);
      await dial();
      assert.strictEqual(notes.filter((n) => n === 'Call limit reached').length, 1, 'only one limit alert');
      const mine = JSON.parse((await appCall(r.link.split('key=')[1], null)).body);
      assert.strictEqual(mine.usage.cap, 2);
      assert.strictEqual(mine.usage.count, 4);
    } finally {
      notify.send = realSend;
      delete process.env.CUSTOMER_MONTHLY_CALLS;
    }
  });

  await test('usage cap: your own calls are not limited by default', async () => {
    db.clear();
    for (let i = 0; i < 5; i++) assert.match((await call(voice, '/api/voice', { From: '+19195559998' })).body, /<Gather/);
    const d = JSON.parse((await appCall('adminkey12345', null)).body);
    assert.strictEqual(d.usage.cap, 0);
    assert.strictEqual(d.usage.count, 5);
  });

  await test('missed call alert says the app did not answer when the app was the target', async () => {
    db.clear();
    await appCall('adminkey12345', { action: 'ringmode', mode: 'app' });
    const sent = [];
    const realSend = notify.send;
    notify.send = async (o) => { sent.push(o.body); };
    try {
      const info = Buffer.from(JSON.stringify({ s: 'Test', c: 'person', f: '+19195551234' })).toString('base64url');
      await call(dialDone, '/api/dial-done?i=' + info, { DialCallStatus: 'no-answer' });
      assert.match(sent.join(' '), /Android app did not answer/);
    } finally {
      notify.send = realSend;
    }
  });

  console.log(failures ? `\n${failures} voicemail test(s) FAILED` : '\nAll voicemail tests passed');
  process.exit(failures ? 1 : 0);
})();
