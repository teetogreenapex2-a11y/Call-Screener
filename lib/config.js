// Central settings. Read from environment on every call so changes in Vercel take effect on redeploy.

function cfg() {
  const e = process.env;
  return {
    ownerName: e.OWNER_NAME || 'Rick',
    ownerPhone: e.OWNER_PHONE || '',
    ownerContext:
      e.OWNER_CONTEXT ||
      'Rick runs Tee to Green Golf (golf launch monitors, including Rapsodo) and BookMyPro (booking software for golf instructors). ' +
        'Customers, golf instructors, vendors, shipping and delivery companies, and family members are legitimate callers.',
    model: e.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
    maxRounds: Math.max(1, Number(e.MAX_ROUNDS || 2)),
    voice: e.TTS_VOICE || 'Polly.Joanna-Neural',
    language: 'en-US',
    // How long your phone rings before voicemail. Keep it shorter than your carrier's voicemail
    // (usually 20+ seconds) so ours answers first.
    ringSeconds: Math.min(60, Math.max(8, Number(e.RING_SECONDS || 18))),
    // Used until you text VM ON or VM OFF (or if the settings database is not connected).
    voicemailDefault: String(e.VOICEMAIL_DEFAULT || 'off').toLowerCase() === 'on',
  };
}

// Always discloses that the caller is talking to an AI.
function greeting(c) {
  return `Hi, this is an AI call assistant for ${c.ownerName}. Please say your name and the reason for your call.`;
}

module.exports = { cfg, greeting };
