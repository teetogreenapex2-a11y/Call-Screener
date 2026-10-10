// Plays a voicemail. The link comes from your notification and carries a signature,
// so it only works for recordings this app announced.
const { verify } = require('../lib/links');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const recSid = url.searchParams.get('r');

  if (!verify(recSid, url.searchParams.get('k'))) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !auth) {
    res.statusCode = 500;
    return res.end('Twilio credentials are not set');
  }

  try {
    const upstream = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Recordings/${recSid}.mp3`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${auth}`).toString('base64') },
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) {
      res.statusCode = upstream.status === 404 ? 404 : 502;
      return res.end(upstream.status === 404 ? 'Recording not found (it may have been deleted)' : 'Could not fetch the recording');
    }
    const audio = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audio.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(audio);
  } catch (err) {
    console.error('listen failed:', err && err.message);
    res.statusCode = 502;
    res.end('Could not fetch the recording');
  }
};
