# Getting Call Screener onto Google Play

## 1. One-time: the signing key (do this first)
1. In `play-secrets` (the folder sent with this zip, NOT in the repo) you have `GITHUB-SECRETS.txt` and `keystore-base64.txt`.
2. GitHub repo > Settings > Secrets and variables > Actions > New repository secret. Add the four secrets listed in `GITHUB-SECRETS.txt`.
3. Push any change under `android/` (or run the workflow). The release now also contains `app-release.aab`, the file you upload to Play.
4. Keep a safe copy of the keystore and passwords. Play App Signing keeps the real key; this is only the upload key, and Google can reset it if you lose it.

## 2. Play Console account
- Create a developer account (one-time fee). A personal account must run a closed test with at least 12 testers for 14 days before it can publish. An organization account (needs a D-U-N-S number) is exempt. Check Google's current rules before you start.
- Package name `com.teetogreengolf.callscreener` is permanent once the app is created.

## 3. App content to fill in
- **Privacy policy URL:** `https://call-screener-chi.vercel.app/privacy.html`
- **Category:** Tools or Communication. **Contains ads:** No.
- **Target audience:** 18+.

### Data safety form (answers)
| Data type | Collected | Shared with third parties* | Why | Optional |
|---|---|---|---|---|
| Phone number (callers' numbers, your number) | Yes | Yes | App functionality | No |
| Contacts (names, numbers) | Yes | No | App functionality (ring-through list) | Yes |
| Audio files (voicemail) | Yes | Yes | App functionality | Yes |
| User IDs (your private access key, push token) | Yes | Yes | App functionality | No |
| Call text / voice (caller's speech as text) | Yes | Yes | App functionality | No |
- Data is encrypted in transit: **Yes**.
- Users can request deletion: **Yes**, by email.
- *Twilio, Anthropic and Firebase process data for us. Google's form lets you exclude a provider that only processes data on your behalf, but read the current definitions and choose carefully.

### Permission declarations (Google will ask)
- **READ_CONTACTS:** core function, rings approved contacts straight through and shows their names.
- **RECORD_AUDIO and FOREGROUND_SERVICE_MICROPHONE:** audio for VoIP calls you answer in the app. Needs a short screen-recording video for review.
- **USE_FULL_SCREEN_INTENT:** shows the incoming-call screen over the lock screen. This is a calling app.
- **POST_NOTIFICATIONS:** incoming-call alerts.

## 4. Store listing draft
**Title:** Call Screener: AI Call Assistant
**Short description (80):** An AI answers unknown callers and only rings you for the ones that matter.
**Full description:**
Stop spam and scam calls without missing the real ones.

Call Screener answers your calls with an AI assistant that asks who is calling and why. If it is a real person with a real reason, your phone rings with a summary on screen. Robocalls, scams and sales pitches never reach you.

- Saved contacts ring straight through, with names.
- See who called and why, in a simple call list.
- Optional voicemail with transcripts.
- Set how long it rings.
- The AI always tells callers it is an AI.

**Requirements:** You forward your calls to your screening number, so your carrier must support call forwarding. Not every carrier does. Needs data or Wi-Fi to ring.

## 5. Before you submit
- Test on a few phones, including a lock-screen call.
- Check Google's current minimum target SDK level for new apps. Raise `targetSdk` in `app/build.gradle.kts` if required.
- Take screenshots (phone), a 512 px icon, and a 1024x500 feature graphic.
- Consider a more distinctive app name, so it does not clash with other apps on Play.

## Not built yet
- Automatic deletion of old voicemail recordings.
- Sign-up and payment, so a customer can get their own screening number.
