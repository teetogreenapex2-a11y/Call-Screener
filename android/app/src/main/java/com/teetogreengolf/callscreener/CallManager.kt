package com.teetogreengolf.callscreener

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.twilio.voice.Call
import com.twilio.voice.CallException
import com.twilio.voice.CallInvite

// Holds the current incoming call or active call, so the notification, the call screen and the service share it.
object CallManager {
    const val CHANNEL_INCOMING = "incoming_calls_v1"
    const val CHANNEL_ONGOING = "ongoing_call_v1"
    const val NOTIF_INCOMING = 1001

    @Volatile var invite: CallInvite? = null
    @Volatile var call: Call? = null
    @Volatile var who: String = ""
    @Volatile var summary: String = ""
    @Volatile var listener: Listener? = null
    private var appCtx: Context? = null

    interface Listener {
        fun onInviteCancelled()
        fun onState(text: String)
        fun onEnded()
    }

    fun onInvite(ctx: Context, ci: CallInvite) {
        appCtx = ctx.applicationContext
        invite = ci
        val p = ci.customParameters
        val name = p["name"].orEmpty()
        val from = p["from"] ?: ci.from.orEmpty()
        who = if (name.isNotEmpty()) name else pretty(from)
        val cat = p["category"].orEmpty()
        val sum = p["summary"].orEmpty()
        summary = if (cat.isNotEmpty()) "[$cat] $sum" else sum
        ensureChannels(ctx)
        showIncoming(ctx)
    }

    fun onInviteCancelled(ctx: Context) {
        invite = null
        cancelIncoming(ctx)
        listener?.onInviteCancelled()
    }

    fun decline(ctx: Context) {
        invite?.reject(ctx)
        invite = null
        cancelIncoming(ctx)
        listener?.onInviteCancelled()
    }

    fun answer(ctx: Context) {
        val ci = invite ?: return
        appCtx = ctx.applicationContext
        cancelIncoming(ctx)
        ContextCompat.startForegroundService(ctx, Intent(ctx, CallService::class.java))
        setAudio(ctx, true)
        call = ci.accept(ctx, callListener)
        invite = null
    }

    fun hangUp() {
        call?.disconnect()
    }

    private val callListener = object : Call.Listener {
        override fun onRinging(call: Call) {}

        override fun onConnectFailure(call: Call, callException: CallException) {
            finish("Call failed")
        }

        override fun onConnected(call: Call) {
            listener?.onState("Connected")
        }

        override fun onReconnecting(call: Call, callException: CallException) {
            listener?.onState("Reconnecting...")
        }

        override fun onReconnected(call: Call) {
            listener?.onState("Connected")
        }

        override fun onDisconnected(call: Call, callException: CallException?) {
            finish("Call ended")
        }
    }

    private fun finish(text: String) {
        val ctx = appCtx
        call = null
        invite = null
        if (ctx != null) {
            setAudio(ctx, false)
            ctx.stopService(Intent(ctx, CallService::class.java))
        }
        listener?.onState(text)
        listener?.onEnded()
    }

    fun setAudio(ctx: Context, on: Boolean) {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = if (on) AudioManager.MODE_IN_COMMUNICATION else AudioManager.MODE_NORMAL
        if (!on) am.isSpeakerphoneOn = false
    }

    fun pretty(n: String): String {
        val d = n.filter { it.isDigit() }.takeLast(10)
        return if (d.length == 10) "(" + d.substring(0, 3) + ") " + d.substring(3, 6) + "-" + d.substring(6) else n.ifEmpty { "Unknown caller" }
    }

    fun ensureChannels(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val incoming = NotificationChannel(CHANNEL_INCOMING, "Incoming calls", NotificationManager.IMPORTANCE_HIGH)
        incoming.description = "Rings when the screener approves a call"
        incoming.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), attrs)
        incoming.enableVibration(true)
        incoming.vibrationPattern = longArrayOf(0, 800, 600, 800)
        incoming.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        nm.createNotificationChannel(incoming)

        val ongoing = NotificationChannel(CHANNEL_ONGOING, "Call in progress", NotificationManager.IMPORTANCE_LOW)
        nm.createNotificationChannel(ongoing)
    }

    private fun showIncoming(ctx: Context) {
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        val open = Intent(ctx, CallActivity::class.java).apply {
            action = CallActivity.ACTION_INCOMING
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val answerIntent = Intent(ctx, CallActivity::class.java).apply {
            action = CallActivity.ACTION_ANSWER
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val openPi = PendingIntent.getActivity(ctx, 1, open, flags)
        val answerPi = PendingIntent.getActivity(ctx, 2, answerIntent, flags)
        val declinePi = PendingIntent.getBroadcast(ctx, 3, Intent(ctx, DeclineReceiver::class.java), flags)

        val n = NotificationCompat.Builder(ctx, CHANNEL_INCOMING)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(who)
            .setContentText(summary.ifEmpty { "Screened call" })
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setTimeoutAfter(30000)
            .setContentIntent(openPi)
            .setFullScreenIntent(openPi, true)
            .addAction(0, "Decline", declinePi)
            .addAction(0, "Answer", answerPi)
            .build()
        n.flags = n.flags or Notification.FLAG_INSISTENT

        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_INCOMING, n)
    }

    fun cancelIncoming(ctx: Context) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIF_INCOMING)
    }
}
