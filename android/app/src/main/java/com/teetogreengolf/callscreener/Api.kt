package com.teetogreengolf.callscreener

import android.content.Context
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

object Api {
    // Calls your server with your private key. Pass a body to POST JSON, or null to GET.
    fun request(ctx: Context, path: String, body: String? = null): String {
        val key = Prefs.key(ctx) ?: throw IllegalStateException("Not signed in yet")
        val conn = URL(BuildConfig.BASE_URL + path).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.setRequestProperty("x-admin-key", key)
            if (body != null) {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) throw IOException("Server said HTTP $code")
            return text
        } finally {
            conn.disconnect()
        }
    }
}
