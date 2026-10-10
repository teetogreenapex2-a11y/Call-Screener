# Call Screener

Twilio answers the call, Claude decides if the caller is legit, you get a text summary.

```
Caller -> Twilio number -> /api/voice  (AI greeting, listens)
                        -> /api/gather (Claude: ask / ring you / reject)
                        -> text summary to your phone
```

## Files

- `api/voice.js` - first webhook; greets and listens
- `api/gather.js` - runs after each thing the caller says; Claude decides; rings you or hangs up
- `lib/claude.js` - the screening prompt and the decision logic (edit the rules here)
- `lib/config.js` - greeting text and defaults
- `lib/notify.js` - text message and optional ntfy push
- `test/run.js` - `npm test` runs the whole flow with a fake Claude

## Setup

1. Push this folder to a new GitHub repo and import it in Vercel.
2. Add the environment variables from `.env.example` in Vercel (Project > Settings > Environment Variables), then redeploy.
3. In Twilio, buy a local number. Under Voice Configuration set **A call comes in** to Webhook, `POST`,
   `https://YOUR-PROJECT.vercel.app/api/voice`
4. Call the Twilio number from a different phone.

## Notes

- Behavior when something breaks: the call is connected to you, never dropped.
- A Twilio trial account only connects to verified numbers and plays a trial message. Add credit to remove that.
- If you don't answer after Claude rings you through, the call just ends. Voicemail is a good next addition.
- US text messages from a brand-new Twilio number can be blocked until carrier registration is done. Set `NTFY_TOPIC` (free ntfy app) to get push notifications immediately.
- Twilio's built-in speech recognition bills per 15 seconds of listening, so most of the per-call cost is there.
