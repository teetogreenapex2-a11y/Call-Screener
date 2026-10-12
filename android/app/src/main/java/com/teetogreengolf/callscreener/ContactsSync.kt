package com.teetogreengolf.callscreener

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

// Copies your phone's contacts (names and numbers) to your ring-through list.
// New contacts are added; nothing already on the list is removed.
object ContactsSync {
    fun sync(ctx: Context, onDone: (String) -> Unit) {
        val app = ctx.applicationContext
        if (ContextCompat.checkSelfPermission(app, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            onDone("Contacts permission is off")
            return
        }
        Thread {
            try {
                val entries = JSONArray()
                val seen = HashSet<String>()
                val cursor = app.contentResolver.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    arrayOf(
                        ContactsContract.CommonDataKinds.Phone.NUMBER,
                        ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME
                    ),
                    null, null, null
                )
                cursor?.use { c ->
                    val numberCol = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
                    val nameCol = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                    while (c.moveToNext()) {
                        val digits = (c.getString(numberCol) ?: "").filter { it.isDigit() }
                        if (digits.length < 10) continue
                        val last10 = digits.takeLast(10)
                        if (!seen.add(last10)) continue
                        entries.put(JSONObject().put("n", last10).put("name", c.getString(nameCol) ?: ""))
                        if (entries.length() >= 20000) break
                    }
                }
                if (entries.length() == 0) {
                    onDone("No contacts with phone numbers found")
                    return@Thread
                }
                val body = JSONObject().put("action", "import").put("entries", entries).put("skipRemoved", true).toString()
                Api.request(app, "/api/app", body)
                onDone("Synced " + entries.length() + " contacts")
            } catch (e: Exception) {
                onDone("Contact sync failed: " + e.message)
            }
        }.start()
    }
}
