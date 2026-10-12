package com.teetogreengolf.callscreener

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.twilio.voice.CallException
import com.twilio.voice.CallInvite
import com.twilio.voice.CancelledCallInvite
import com.twilio.voice.MessageListener
import com.twilio.voice.Voice

// Firebase wakes the app here when Twilio has a call for this phone.
class ScreenerFcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        Registrar.register(applicationContext)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        Prefs.setPush(applicationContext, "Last push received " + java.text.DateFormat.getTimeInstance().format(java.util.Date()) + " (" + data.size + " fields)")
        if (data.isEmpty()) return
        val handled = Voice.handleMessage(applicationContext, data, object : MessageListener {
            override fun onCallInvite(callInvite: CallInvite) {
                Prefs.setPush(applicationContext, "Call invite received " + java.text.DateFormat.getTimeInstance().format(java.util.Date()))
                CallManager.onInvite(applicationContext, callInvite)
            }

            override fun onCancelledCallInvite(cancelledCallInvite: CancelledCallInvite, callException: CallException?) {
                CallManager.onInviteCancelled(applicationContext)
            }
        })
        if (!handled) Prefs.setPush(applicationContext, "Push was not a Twilio call message")
    }
}
