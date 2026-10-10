// Twilio calls this when someone dials your screening number.
const { isValid } = require('../lib/twilio-verify');
const { cfg, greeting } = require('../lib/config');
const { VoiceResponse, buildGather, reply, forbidden } = require('../lib/twiml');

module.exports = async function handler(req, res) {
  if (!isValid(req)) return forbidden(res);

  const c = cfg();
  const text = greeting(c);
  const vr = new VoiceResponse();
  buildGather(vr, c, 0, [{ who: 'assistant', text }], text);
  return reply(res, vr);
};
