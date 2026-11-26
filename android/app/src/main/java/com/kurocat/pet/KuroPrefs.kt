package com.kurocat.pet

import android.content.Context
import org.json.JSONObject

data class KuroSkinOption(
    val id: String,
    val emoji: String,
    val name: String,
    val accentHex: Int
)

object KuroPrefs {
    private const val PREF_NAME = "kurocat_prefs"

    val SKINS = listOf(
        KuroSkinOption("black", "🐈‍⬛", "小黑猫", 0xFFC8F538.toInt()),
        KuroSkinOption("ragdoll", "🐱", "布偶猫", 0xFF7AC7FF.toInt()),
        KuroSkinOption("orange-tabby", "🍊", "大橘猫", 0xFFFFAE42.toInt()),
        KuroSkinOption("calico", "🌸", "三花猫", 0xFFFF88B5.toInt()),
        KuroSkinOption("tuxedo", "🐄", "奶牛猫", 0xFFD8E2F0.toInt()),
        KuroSkinOption("siamese", "🤎", "暹罗猫", 0xFFD4A373.toInt()),
        KuroSkinOption("dafeiyu", "🐳", "大肥鱼", 0xFF5CC8FF.toInt()),
    )

    private fun sp(ctx: Context) = ctx.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)

    fun getBreed(ctx: Context): String = sp(ctx).getString("breed", "black") ?: "black"
    fun setBreed(ctx: Context, v: String) = sp(ctx).edit().putString("breed", v).apply()

    fun getLayout(ctx: Context): String = sp(ctx).getString("layout", "65") ?: "65"
    fun setLayout(ctx: Context, v: String) = sp(ctx).edit().putString("layout", v).apply()

    fun getOrientation(ctx: Context): String = sp(ctx).getString("orientation", "cat") ?: "cat"
    fun setOrientation(ctx: Context, v: String) = sp(ctx).edit().putString("orientation", v).apply()

    fun getScale(ctx: Context): Float = sp(ctx).getFloat("scale", 0.78f).coerceIn(0.35f, 1.40f)
    fun setScale(ctx: Context, v: Float) =
        sp(ctx).edit().putFloat("scale", v.coerceIn(0.35f, 1.40f)).apply()

    fun isShowKeyBubbles(ctx: Context): Boolean = sp(ctx).getBoolean("show_bubbles", true)
    fun setShowKeyBubbles(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("show_bubbles", v).apply()

    fun isSoundEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("sound_enabled", true)
    fun setSoundEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("sound_enabled", v).apply()

    fun isPrivacyGuardEnabled(ctx: Context): Boolean = sp(ctx).getBoolean("privacy_guard", true)
    fun setPrivacyGuardEnabled(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("privacy_guard", v).apply()

    fun isTouchThroughLocked(ctx: Context): Boolean = sp(ctx).getBoolean("touch_through", false)
    fun setTouchThroughLocked(ctx: Context, v: Boolean) =
        sp(ctx).edit().putBoolean("touch_through", v).apply()

    fun getOverlayX(ctx: Context, defaultX: Int): Int = sp(ctx).getInt("overlay_x", defaultX)
    fun getOverlayY(ctx: Context, defaultY: Int): Int = sp(ctx).getInt("overlay_y", defaultY)
    fun setOverlayPos(ctx: Context, x: Int, y: Int) =
        sp(ctx).edit().putInt("overlay_x", x).putInt("overlay_y", y).apply()

    fun nextBreed(ctx: Context): String {
        val cur = getBreed(ctx)
        val idx = SKINS.indexOfFirst { it.id == cur }
        val next = SKINS[(idx + 1) % SKINS.size].id
        setBreed(ctx, next)
        return next
    }

    fun toJsJson(ctx: Context, privacyActive: Boolean = false): String {
        return JSONObject().apply {
            put("catBreed", getBreed(ctx))
            put("keyboardLayout", getLayout(ctx))
            put("keyboardOrientation", getOrientation(ctx))
            put("showKeyBubbles", isShowKeyBubbles(ctx))
            put("soundEnabled", isSoundEnabled(ctx))
            put("privacyMode", privacyActive && isPrivacyGuardEnabled(ctx))
        }.toString()
    }
}
