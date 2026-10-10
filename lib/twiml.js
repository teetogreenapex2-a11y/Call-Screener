const twilio = require('twilio');

const { VoiceResponse } = twilio.twiml;

// Conversation state travels in the URL (the function is stateless). The URL is covered
// by Twilio's signature, so a caller cannot tamper with it.
function encode(history) {
  return Buffer.from(JSON.stringify(history)).toString('base64url');
}

function decode(s) {
  if (!s) return [];
  try {
    const arr = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (!Array.isArray(arr)) return [];
    return arr.slice(-8).map((x) => ({
      who: x && x.who === 'caller' ? 'caller' : 'assistant',
      text: String((x && x.text) || '').slice(0, 300),
    }));
  } catch (_) {
    return [];
  }
}

function sayTo(parent, c, text) {
  parent.say({ voice: c.voice, language: c.language }, text);
}

// Speak a prompt and listen for the caller's answer. If they say nothing, Twilio falls
// through to the redirect, which lands on the same handler with no SpeechResult.
function buildGather(vr, c, round, history, text) {
  const target = `/api/gather?r=${round}&t=${encode(history)}`;
  const gather = vr.gather({
    input: 'speech',
    action: target,
    method: 'POST',
    speechTimeout: 'auto',
    timeout: 6,
    speechModel: 'phone_call',
    enhanced: true,
    language: c.language,
  });
  sayTo(gather, c, text);
  vr.redirect({ method: 'POST' }, target);
}

function reply(res, vr) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml');
  res.end(vr.toString());
}

function forbidden(res) {
  res.statusCode = 403;
  res.end('Forbidden');
}

module.exports = { VoiceResponse, encode, decode, sayTo, buildGather, reply, forbidden };
