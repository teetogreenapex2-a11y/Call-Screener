package com.teetogreengolf.callscreener

import android.content.Context

object Prefs {
    private fun sp(c: Context) = c.applicationContext.getSharedPreferences("screener", Context.MODE_PRIVATE)

    // The private key from the web app (your ADMIN_KEY, or a customer's own key).
    fun key(c: Context): String? = sp(c).getString("key", null)

    fun setKey(c: Context, k: String) {
        sp(c).edit().putString("key", k).apply()
    }

    // A short line shown in the app: whether calls can reach this phone.
    fun status(c: Context): String = sp(c).getString("status", "Starting...") ?: ""

    fun setStatus(c: Context, s: String) {
        sp(c).edit().putString("status", s).apply()
    }

    fun flag(c: Context, name: String): Boolean = sp(c).getBoolean(name, false)

    fun setFlag(c: Context, name: String) {
        sp(c).edit().putBoolean(name, true).apply()
    }
}
