package com.teetogreengolf.callscreener

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// The app is your web app in a window, plus the phone-only parts: ringing for calls and syncing contacts.
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var autoSynced = false

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        afterPermissions()
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.root)) { v, insets ->
            val b = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(b.left, b.top, b.right, b.bottom)
            WindowInsetsCompat.CONSUMED
        }

        web = findViewById(R.id.web)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.addJavascriptInterface(Bridge(), "AndroidBridge")
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return true
                if (BuildConfig.BASE_URL.contains(host)) return false
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }
        }
        web.loadUrl(BuildConfig.BASE_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        askPermissions()
        Registrar.register(this)
    }

    private fun askPermissions() {
        val wanted = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_CONTACTS)
        if (Build.VERSION.SDK_INT >= 33) wanted.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) afterPermissions() else permissions.launch(missing.toTypedArray())
    }

    // One-time prompts so calls can ring over the lock screen and are not delayed by battery saving.
    private fun afterPermissions() {
        if (!Prefs.flag(this, "asked_special")) {
            Prefs.setFlag(this, "asked_special")
            try {
                val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                if (Build.VERSION.SDK_INT >= 34 && !nm.canUseFullScreenIntent()) {
                    startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:$packageName")))
                } else {
                    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
                    if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    }
                }
            } catch (_: Exception) {
            }
        }
        if (!autoSynced && Prefs.key(this) != null) syncContacts(false)
    }

    private fun syncContacts(manual: Boolean) {
        autoSynced = true
        ContactsSync.sync(this) { msg ->
            runOnUiThread {
                if (manual) Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                web.evaluateJavascript("window.refreshApp && window.refreshApp()", null)
            }
        }
    }

    inner class Bridge {
        // The web app calls this after you sign in, so the phone part can use the same key.
        @JavascriptInterface
        fun setKey(key: String) {
            if (key.isBlank() || key == Prefs.key(this@MainActivity)) return
            Prefs.setKey(this@MainActivity, key)
            runOnUiThread {
                Registrar.register(this@MainActivity)
                syncContacts(false)
            }
        }

        @JavascriptInterface
        fun syncContacts() {
            runOnUiThread { syncContacts(true) }
        }

        @JavascriptInterface
        fun status(): String = Prefs.status(this@MainActivity)
    }
}
