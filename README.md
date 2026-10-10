# Call Screener

Twilio answers the call, Claude decides if the caller is legit, you get a text summary.
If you don't pick up, the caller can leave a voicemail (when you've switched that on).

```
Caller -> Twilio number -> /api/voice        AI greeting, listens
                        -> /api/gather       Claude: ask / ring you / reject
                        -> /api/dial-done    you didn't answer: voicemail or goodbye
                        -> /api/recording, /api/transcription   voicemail arrives as text + link
You    -> text "VM ON" / "VM OFF" to the Twilio number -> /api/sms
```

## Files

- `api/voice.js` - first webhook; greets and listens
- `api/gather.js` - runs after each thing the caller says; Claude decides; rings you or hangs up
- `api/dial-done.js` - runs when ringing your phone ends; takes a voicemail if it is switched on
- `api/recording.js`, `api/transcription.js` - voicemail notifications (transcript + link)
- `api/listen.js` - plays a voicemail from the signed link in the notification
- `api/sms.js` - the text-message switch (only your own phone can use it)
- `lib/claude.js` - the screening prompt and the decision logic (edit the rules here)
- `lib/config.js` - greeting text and defaults
- `lib/store.js`, `lib/settings.js` - the on/off setting, kept in the Upstash Redis database
- `lib/notify.js` - text message and optional ntfy push
- `test/` - `npm test` runs the whole flow with a fake Claude and a fake database

## Setup

1. Push this folder to a GitHub repo and import it in Vercel.
2. Add the environment variables from `.env.example` in Vercel (Project > Settings > Environment Variables).
3. Vercel > your project > **Storage** > create an **Upstash Redis** database (free plan) and connect it to the project. This adds the database variables for you. Redeploy.
4. In Twilio, open your number > Configure:
   - Voice, **A call comes in**: Webhook, `POST`, `https://YOUR-PROJECT.vercel.app/api/voice`
   - Messaging, **A message comes in**: Webhook, `POST`, `https://YOUR-PROJECT.vercel.app/api/sms`
5. Call the Twilio number from a different phone. Text `VM ON` from your own phone to turn voicemail on.

## Notes

- Voicemail starts OFF (set `VOICEMAIL_DEFAULT=on` to change that). Texting `VM ON` / `VM OFF` overrides it.
- Your phone rings for 18 seconds (`RING_SECONDS`) before voicemail, so ours answers before your carrier's does.
- Voicemail recordings stay in your Twilio account until you delete them. Twilio charges for storage and for transcription (English only, messages over 2 seconds).
- Behavior when something breaks: the call is connected to you, never dropped.
- A Twilio trial account only connects to verified numbers and plays a trial message. Add credit to remove that.
- Text replies from a new US Twilio number can be filtered until carrier registration is done. Set `NTFY_TOPIC` (free ntfy app) to get push notifications and setting confirmations immediately.
- Twilio's built-in speech recognition bills per 15 seconds of listening, so most of the per-call cost is there.
- Recording laws vary by state. The voicemail greeting tells callers the message is recorded and transcribed.
