package com.pos2013.offline.utils

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * Manages manual language selection for the POS app.
 * Language choice is persisted in SharedPrefs and applied at Activity start.
 *
 * Supported languages:
 *   en  — English (default)
 *   fr  — French
 *   de  — German
 *   zh  — Chinese (Simplified)
 *   th  — Thai
 *   el  — Greek
 *   iw  — Hebrew (Jewish)
 *   ar  — Arabic
 *   ru  — Russian
 *   sw  — Swahili (African)
 */
object LanguageManager {

    private const val PREFS    = "pos_settings"
    private const val KEY_LANG = "app_language"

    data class Language(
        val code:  String,   // BCP-47 / Android locale code
        val label: String,   // Native name shown in picker
        val flag:  String    // Emoji flag
    )

    val LANGUAGES = listOf(
        Language("en", "English",    "🇬🇧"),
        Language("fr", "Français",   "🇫🇷"),
        Language("de", "Deutsch",    "🇩🇪"),
        Language("zh", "中文",        "🇨🇳"),
        Language("th", "ภาษาไทย",    "🇹🇭"),
        Language("el", "Ελληνικά",   "🇬🇷"),
        Language("iw", "עברית",      "🇮🇱"),
        Language("ar", "العربية",    "🇸🇦"),
        Language("ru", "Русский",    "🇷🇺"),
        Language("sw", "Kiswahili",  "🌍")
    )

    /** Save the selected language code */
    fun save(context: Context, code: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_LANG, code).apply()
    }

    /** Get the currently saved language code (defaults to "en") */
    fun get(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LANG, "en") ?: "en"

    /** Apply the saved language to a Context (call in attachBaseContext) */
    fun applyTo(context: Context): Context {
        val code = get(context)
        if (code == "en") return context   // system default, no override needed
        val locale = when (code) {
            "zh"  -> Locale.SIMPLIFIED_CHINESE
            "iw"  -> Locale("iw")           // Hebrew (Android uses "iw" not "he")
            else  -> Locale(code)
        }
        Locale.setDefault(locale)
        val config = Configuration(context.resources.configuration)
        config.setLocale(locale)
        return context.createConfigurationContext(config)
    }

    /** Display string for current language (e.g. "🇫🇷 Français") */
    fun currentLabel(context: Context): String {
        val code = get(context)
        val lang = LANGUAGES.find { it.code == code } ?: LANGUAGES[0]
        return "${lang.flag}  ${lang.label}"
    }
}
