package com.teetogreengolf.callscreener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// The Decline button on the incoming-call notification.
class DeclineReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        CallManager.decline(context.applicationContext)
    }
}
