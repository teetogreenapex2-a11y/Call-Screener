package com.teetogreengolf.callscreener

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.twilio.voice.RegistrationException
import com.twilio.voice.RegistrationListener
import com.twilio.voice.Voice
import org.json.JSONObject

// Tells Twilio that this phone can take calls, so approved callers can ring the app.
object Registrar {
    private const val TAG = "Registrar"

    fun register(ctx: Context) {
        val app = ctx.applicationContext
        if (Prefs.key(app) == null) {
            Prefs.setStatus(app, "Sign in to the app first")
            return
        }
        if (FirebaseApp.getApps(app).isEmpty()) {
            Prefs.setStatus(app, "Not ready: Firebase is not set up in this build yet")
            return
        }
        Thread {
            try {
                val json = JSONObject(Api.request(app, "/api/voice-token"))
                if (json.has("error")) {
                    Prefs.setStatus(app, json.getString("error"))
                    return@Thread
                }
                val token = json.getString("token")
                FirebaseMessaging.getInstance().token
                    .addOnSuccessListener { fcm ->
                        Voice.register(token, Voice.RegistrationChannel.FCM, fcm, object : RegistrationListener {
                            override fun onRegistered(accessToken: String, fcmToken: String) {
                                Prefs.setStatus(app, "Ready: calls can ring this phone")
                            }

                            override fun onError(registrationException: RegistrationException, accessToken: String, fcmToken: String) {
                                Log.e(TAG, "Registration failed", registrationException)
                                Prefs.setStatus(app, "Registration failed: " + registrationException.message)
                            }
                        })
                    }
                    .addOnFailureListener { e ->
                        Prefs.setStatus(app, "Could not get a push token: " + e.message)
                    }
            } catch (e: Exception) {
                Log.e(TAG, "Could not register", e)
                Prefs.setStatus(app, "Could not reach the server: " + e.message)
            }
        }.start()
    }
}
