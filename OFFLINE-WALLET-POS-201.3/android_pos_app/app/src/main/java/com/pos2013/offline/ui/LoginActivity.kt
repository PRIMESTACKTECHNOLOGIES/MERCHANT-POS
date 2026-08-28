package com.pos2013.offline.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.pos2013.offline.databinding.ActivityLoginBinding
import com.pos2013.offline.security.AuthManager

class LoginActivity : AppCompatActivity() {
    private lateinit var binding: ActivityLoginBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        AuthManager.ensureDefaults(this)

        binding.btnLogin.setOnClickListener {
            val username = binding.etUsername.text?.toString()?.trim().orEmpty()
            val password = binding.etPassword.text?.toString()?.trim().orEmpty()

            if (username.isEmpty() || password.isEmpty()) {
                Toast.makeText(this, "Enter username and password", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            binding.progressBar.visibility = View.VISIBLE
            binding.btnLogin.isEnabled = false

            val ok = AuthManager.validate(this, username, password)
            if (ok) {
                AuthManager.markUnlocked(this)
                if (AuthManager.requiresPasswordChange(this)) {
                    startActivity(Intent(this, SettingsActivity::class.java).apply {
                        putExtra("open_security", true)
                    })
                } else {
                    startActivity(Intent(this, MainActivity::class.java))
                }
                finish()
            } else {
                Toast.makeText(this, "Invalid credentials", Toast.LENGTH_SHORT).show()
            }

            binding.progressBar.visibility = View.GONE
            binding.btnLogin.isEnabled = true
        }
    }

    override fun onBackPressed() {
        moveTaskToBack(true)
    }
}

