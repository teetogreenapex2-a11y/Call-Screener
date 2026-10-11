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

  console.log(failures ? `\n${failures} voicemail test(s) FAILED` : '\nAll voicemail tests passed');
  process.exit(failures ? 1 : 0);
})();
