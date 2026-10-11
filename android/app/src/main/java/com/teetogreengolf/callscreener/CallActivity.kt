package com.teetogreengolf.callscreener

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// The incoming-call screen (works over the lock screen) and the in-call controls.
class CallActivity : AppCompatActivity(), CallManager.Listener {

    companion object {
        const val ACTION_INCOMING = "com.teetogreengolf.callscreener.INCOMING"
        const val ACTION_ANSWER = "com.teetogreengolf.callscreener.ANSWER"
        private const val REQ_MIC = 7
    }

    private lateinit var who: TextView
    private lateinit var summary: TextView
    private lateinit var state: TextView
    private lateinit var incomingRow: View
    private lateinit var activeRow: View
    private lateinit var btnMute: Button
    private lateinit var btnSpeaker: Button
    private var muted = false
    private var speaker = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
        setContentView(R.layout.activity_call)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(b.left + 48, b.top + 48, b.right + 48, b.bottom + 48)
            WindowInsetsCompat.CONSUMED
        }

        who = findViewById(R.id.who)
        summary = findViewById(R.id.summary)
        state = findViewById(R.id.state)
        incomingRow = findViewById(R.id.incomingRow)
        activeRow = findViewById(R.id.activeRow)
        btnMute = findViewById(R.id.btnMute)
        btnSpeaker = findViewById(R.id.btnSpeaker)

        findViewById<Button>(R.id.btnAnswer).setOnClickListener { answer() }
        findViewById<Button>(R.id.btnDecline).setOnClickListener {
            CallManager.decline(applicationContext)
            finish()
        }
        findViewById<Button>(R.id.btnHangup).setOnClickListener { CallManager.hangUp() }
        btnMute.setOnClickListener {
            muted = !muted
            CallManager.call?.mute(muted)
            btnMute.text = if (muted) "Unmute" else "Mute"
        }
        btnSpeaker.setOnClickListener {
            speaker = !speaker
            val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = speaker
            btnSpeaker.text = if (speaker) "Earpiece" else "Speaker"
        }

        CallManager.listener = this
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(i: Intent?) {
        render()
        if (i?.action == ACTION_ANSWER && CallManager.invite != null) answer()
    }

    private fun render() {
        val active = CallManager.call != null
        if (!active && CallManager.invite == null) {
            finish()
            return
        }
        who.text = CallManager.who
        summary.text = CallManager.summary
        incomingRow.visibility = if (active) View.GONE else View.VISIBLE
        activeRow.visibility = if (active) View.VISIBLE else View.GONE
        state.text = if (active) "Connecting..." else "Screened call"
    }

    private fun answer() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        CallManager.answer(this)
        render()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) answer()
    }

    override fun onInviteCancelled() {
        runOnUiThread { finish() }
    }

    override fun onState(text: String) {
        runOnUiThread { state.text = text }
    }

    override fun onEnded() {
        runOnUiThread { finish() }
    }

    override fun onDestroy() {
        if (CallManager.listener === this) CallManager.listener = null
        super.onDestroy()
    }
}
