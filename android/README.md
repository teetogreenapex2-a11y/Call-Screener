# Call Screener Android app

Setup (one time):
1. Firebase: create a project, add an Android app with package `com.teetogreengolf.callscreener`, download `google-services.json` into `android/app/`, commit it.
2. Firebase > Project settings > Service accounts > generate a private key. Twilio Console > Voice > Credentials (Push) > create an FCM credential with that key. Copy its SID (starts with CR).
3. Twilio Console > Account > API keys > create a Standard key. Copy the SID (SK...) and secret.
4. Vercel env vars: TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_PUSH_CREDENTIAL_SID. Redeploy.
5. GitHub > Actions > "Build Android app" > Run workflow. Download app-debug.apk from the `apk-latest` release on your phone and install it.
6. Open the app, sign in with your key, allow microphone, contacts, notifications, battery and full-screen prompts.
7. On Red Pocket forward ALL calls to the Twilio number. Keep "Where calls ring" on App.
