package com.pos2013.offline.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.pos2013.offline.security.AuthManager

class LauncherActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("pos_prefs", MODE_PRIVATE)
        val registered = prefs.getBoolean("device_registered", false)

        AuthManager.ensureDefaults(this)

        val next = when {
            !registered -> Intent(this, SetupActivity::class.java)
            !AuthManager.isUnlocked(this) -> Intent(this, LoginActivity::class.java)
            else -> Intent(this, MainActivity::class.java)
        }

        startActivity(next)
        finish()
    }
}

