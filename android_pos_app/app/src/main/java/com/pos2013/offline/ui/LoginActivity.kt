package com.pos2013.offline.ui

import android.content.Context
import android.content.Intent
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.lifecycleScope
import com.pos2013.offline.PosApplication
import com.pos2013.offline.R
import com.pos2013.offline.data.api.ApiClient
import com.pos2013.offline.viewmodel.LoginViewModel
import com.pos2013.offline.viewmodel.UiState
import kotlinx.coroutines.launch

class LoginActivity : AppCompatActivity() {

    private lateinit var vm: LoginViewModel
    private lateinit var username: EditText
    private lateinit var password: EditText
    private lateinit var serverUrl: EditText
    private lateinit var submit: Button
    private lateinit var progress: ProgressBar
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(64, 128, 64, 64)
            setBackgroundColor(resources.getColor(R.color.pos_background, theme))
        }

        val title = TextView(this).apply {
            text = "PRIMESTACK POS"
            textSize = 30f
            setTextColor(resources.getColor(R.color.pos_on_surface, theme))
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 0, 0, 48)
        }
        root.addView(title)

        serverUrl = labeledField(root, "Backend URL", PosApplication.getServerUrl(this))

        val testConnRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val testConnStatus = TextView(this).apply {
            textSize = 13f
            setPadding(24, 0, 16, 0)
            setTextColor(resources.getColor(R.color.pos_on_surface_variant, theme))
        }
        val btnTestConn = Button(this, null, 0, R.style.Widget_PosApp_Button_Secondary).apply {
            text = "Test Connection"
            setPadding(0, 20, 0, 20)
            setOnClickListener {
                val url = serverUrl.text.toString().trim()
                if (url.isBlank()) {
                    testConnStatus.setTextColor(resources.getColor(R.color.pos_error, theme))
                    testConnStatus.text = "Enter backend URL first"
                    return@setOnClickListener
                }
                isEnabled = false
                testConnStatus.setTextColor(resources.getColor(R.color.pos_warning, theme))
                testConnStatus.text = "Checking..."
                lifecycleScope.launch {
                    try {
                        val call = ApiClient.createHealthApi(url).health()
                        val resp = try { call.execute() } catch (_: Throwable) { null }
                        if (resp != null && resp.isSuccessful) {
                            val raw = try { resp.body()?.toString() ?: "OK" } catch (_: Throwable) { "OK" }
                            testConnStatus.setTextColor(resources.getColor(R.color.pos_success, theme))
                            testConnStatus.text = "✅ Connected — ${raw.take(60)}"
                        } else {
                            testConnStatus.setTextColor(resources.getColor(R.color.pos_error, theme))
                            testConnStatus.text = "❌ HTTP ${resp?.code() ?: "0"} — URL reachable but server returned error"
                        }
                    } catch (e: Throwable) {
                        testConnStatus.setTextColor(resources.getColor(R.color.pos_error, theme))
                        testConnStatus.text = when (e) {
                            is java.net.SocketTimeoutException -> "❌ Timeout — server not responding, check WiFi/firewall"
                            is java.net.ConnectException      -> "❌ Cannot reach IP:port — wrong URL or firewall blocked"
                            is java.net.UnknownHostException  -> "❌ Unknown host — check the URL spelling"
                            else -> "❌ ${(e.localizedMessage ?: e.message).take(70)}"
                        }
                    } finally {
                        isEnabled = true
                    }
                }
            }
        }
        testConnRow.addView(btnTestConn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { weight = 0f })
        testConnRow.addView(testConnStatus, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT).apply { weight = 1f })
        root.addView(testConnRow, linearParams().apply { bottomMargin = 16 })

        username = labeledField(root, "Username / Email", "")
        password = labeledField(root, "Password", "", password = true)

        submit = Button(this, null, 0, R.style.Widget_PosApp_Button).apply {
            text = "LOGIN"
            setPadding(0, 32, 0, 32)
        }
        root.addView(submit, linearParams())

        progress = ProgressBar(this).apply {
            visibility = View.GONE
        }
        root.addView(progress, linearParams().apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = 24
        })

        status = TextView(this).apply {
            textSize = 14f
            setTextColor(resources.getColor(R.color.pos_error, theme))
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, 24, 0, 0)
        }
        root.addView(status, linearParams())

        setContentView(root)

        vm = ViewModelProvider(this)[LoginViewModel::class.java]
        vm.loginState.observe(this) { state ->
            when (state) {
                is UiState.Idle -> {
                }
                is UiState.Loading -> {
                    submit.isEnabled = false
                    progress.visibility = View.VISIBLE
                    status.text = ""
                }
                is UiState.Success -> {
                    val token = state.data.first
                    val user = state.data.second
                    val prefs = getSharedPreferences("pos_settings", Context.MODE_PRIVATE).edit()
                    prefs.putString("server_url", serverUrl.text.toString().trim().ifBlank { "http://10.0.2.2:7000/" })
                    prefs.putString("jwt_token", token)
                    prefs.putString("admin_username", user?.username ?: username.text.toString())
                    prefs.apply()
                    hideKeyboard()
                    startActivity(Intent(this, DashboardActivity::class.java))
                    finish()
                }
                is UiState.Error -> {
                    submit.isEnabled = true
                    progress.visibility = View.GONE
                    status.text = state.message
                }
            }
        }

        submit.setOnClickListener {
            val url = serverUrl.text.toString().trim()
            if (url.isNotBlank()) {
                getSharedPreferences("pos_settings", Context.MODE_PRIVATE).edit()
                    .putString("server_url", url).apply()
            }
            vm.login(username.text.toString().trim(), password.text.toString())
            hideKeyboard()
        }
    }

    private fun labeledField(parent: LinearLayout, label: String, initial: String, password: Boolean = false): EditText {
        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, 24)
        }
        TextView(this).apply {
            text = label
            textSize = 13f
            setTextColor(resources.getColor(R.color.pos_on_surface_variant, theme))
            setPadding(4, 0, 0, 6)
        }.let { wrapper.addView(it) }
        val etBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 16f
            setColor(resources.getColor(R.color.pos_surface, theme))
            setStroke(2, resources.getColor(R.color.pos_surface_variant, theme))
        }
        val et = EditText(this).apply {
            background = etBg
            setText(initial)
            setPadding(40, 28, 40, 28)
            setTextColor(resources.getColor(R.color.pos_on_surface, theme))
            setHintTextColor(resources.getColor(R.color.pos_on_surface_variant, theme))
            inputType = when {
                password -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
                label.contains("URL", true) -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
                else -> android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            }
        }
        wrapper.addView(et, linearParams())
        parent.addView(wrapper, linearParams())
        return et
    }

    private fun linearParams() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
    )

    private fun hideKeyboard() {
        try {
            (getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)
                ?.hideSoftInputFromWindow(currentFocus?.windowToken, 0)
        } catch (_: Throwable) {}
    }

    companion object {
        fun startIfNeeded(ctx: Context): Boolean {
            if (!PosApplication.isLoggedIn(ctx)) {
                ctx.startActivity(Intent(ctx, LoginActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                return true
            }
            return false
        }
    }
}
