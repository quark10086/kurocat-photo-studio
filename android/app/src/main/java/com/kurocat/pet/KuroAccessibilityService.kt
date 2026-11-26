package com.kurocat.pet

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.text.InputType
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Privacy-first AccessibilityService for KuroCat Android:
 * - Drives cat / BigFish typing rhythm purely from event character-count deltas (NEVER stores or
 *   transmits typed text content!).
 * - Detects password fields via `isPassword` / `InputType` to automatically close eyes / cover eyes.
 * - Captures physical Bluetooth/USB keyboard KeyEvents (returning `false` so keys are never consumed).
 */
class KuroAccessibilityService : AccessibilityService() {

    private var lastTextEventMs = 0L
    private var lastClickEventMs = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        KuroEventBus.accessibilityConnected.set(true)
        KuroEventBus.postSettingsChanged()
    }

    override fun onInterrupt() {
        // Nothing to interrupt
    }

    override fun onDestroy() {
        KuroEventBus.accessibilityConnected.set(false)
        KuroEventBus.postPrivacyChanged(false)
        KuroEventBus.postSettingsChanged()
        super.onDestroy()
    }

    private fun isPasswordInputType(inputType: Int): Boolean {
        val cls = inputType and InputType.TYPE_MASK_CLASS
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return when (cls) {
            InputType.TYPE_CLASS_TEXT -> variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
                variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            InputType.TYPE_CLASS_NUMBER -> variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD
            else -> false
        }
    }

    private fun isPasswordEvent(event: AccessibilityEvent): Boolean {
        if (event.isPassword) return true
        val src: AccessibilityNodeInfo? = try {
            event.source
        } catch (_: Throwable) {
            null
        }
        if (src != null) {
            try {
                if (src.isPassword || isPasswordInputType(src.inputType)) {
                    return true
                }
            } finally {
                @Suppress("DEPRECATION")
                src.recycle()
            }
        }
        return false
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        // CRITICAL: Never call `event.source` on events from our own package! Both MainActivity
        // and KuroAccessibilityService share the main thread, so querying `event.source` for our
        // own window deadlocks the AccessibilityInteractionController binder call (5s ANR!).
        // MainActivity handles its own in-app test typing & password boxes directly.
        if (event.packageName?.toString() == packageName) return
        val privacyGuardOn = KuroPrefs.isPrivacyGuardEnabled(this)

        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> {
                if (isPasswordEvent(event)) {
                    if (privacyGuardOn) {
                        KuroEventBus.postPrivacyChanged(true)
                        KuroEventBus.postPrivacyTyping()
                    }
                    return
                }
                if (KuroEventBus.privacyActive.get()) {
                    KuroEventBus.postPrivacyChanged(false)
                }

                val now = System.currentTimeMillis()
                if (now - lastTextEventMs < 35L) return
                lastTextEventMs = now

                val added = event.addedCount
                val removed = event.removedCount
                when {
                    removed > 0 && added == 0 -> KuroEventBus.postTypingBurst(1, "delete")
                    added >= 4 -> KuroEventBus.postTypingBurst(3, "char")
                    added >= 2 -> KuroEventBus.postTypingBurst(2, "char")
                    else -> KuroEventBus.postTypingBurst(1, "char")
                }
            }

            AccessibilityEvent.TYPE_VIEW_FOCUSED -> {
                val isPwd = isPasswordEvent(event)
                KuroEventBus.postPrivacyChanged(privacyGuardOn && isPwd)
            }

            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                // Clear privacy eye-cover when switching away to a new window/screen
                if (KuroEventBus.privacyActive.get() && !event.isPassword) {
                    KuroEventBus.postPrivacyChanged(false)
                }
            }

            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                val now = System.currentTimeMillis()
                if (now - lastClickEventMs < 90L) return
                lastClickEventMs = now

                var nx = 0.5f
                var ny = 0.5f
                val src: AccessibilityNodeInfo? = try {
                    event.source
                } catch (_: Throwable) {
                    null
                }
                if (src != null) {
                    try {
                        val r = Rect()
                        src.getBoundsInScreen(r)
                        val dm = resources.displayMetrics
                        if (dm.widthPixels > 0 && dm.heightPixels > 0 && !r.isEmpty) {
                            nx = (r.centerX().toFloat() / dm.widthPixels).coerceIn(0f, 1f)
                            ny = (r.centerY().toFloat() / dm.heightPixels).coerceIn(0f, 1f)
                        }
                    } finally {
                        @Suppress("DEPRECATION")
                        src.recycle()
                    }
                }
                KuroEventBus.postScreenTap(nx, ny)
            }
        }
    }

    override fun onKeyEvent(event: KeyEvent?): Boolean {
        if (event == null) return false
        val vk = androidKeyCodeToVk(event.keyCode) ?: return false
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (KuroEventBus.privacyActive.get() && KuroPrefs.isPrivacyGuardEnabled(this)) {
                    if (event.repeatCount == 0) {
                        KuroEventBus.postPrivacyTyping()
                    }
                } else {
                    KuroEventBus.postHardwareKey(vk, true, event.repeatCount > 0)
                }
            }
            KeyEvent.ACTION_UP -> {
                KuroEventBus.postHardwareKey(vk, false, false)
            }
        }
        // Always return false so KuroCat never intercepts or blocks normal user input!
        return false
    }

    private fun androidKeyCodeToVk(code: Int): Int? = when (code) {
        in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> 0x41 + (code - KeyEvent.KEYCODE_A)
        in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> 0x30 + (code - KeyEvent.KEYCODE_0)
        KeyEvent.KEYCODE_ENTER -> 0x0D
        KeyEvent.KEYCODE_NUMPAD_ENTER -> 0x10D
        KeyEvent.KEYCODE_SPACE -> 0x20
        KeyEvent.KEYCODE_DEL -> 0x08
        KeyEvent.KEYCODE_FORWARD_DEL -> 0x2E
        KeyEvent.KEYCODE_TAB -> 0x09
        KeyEvent.KEYCODE_ESCAPE -> 0x1B
        KeyEvent.KEYCODE_CAPS_LOCK -> 0x14
        KeyEvent.KEYCODE_SHIFT_LEFT -> 0xA0
        KeyEvent.KEYCODE_SHIFT_RIGHT -> 0xA1
        KeyEvent.KEYCODE_CTRL_LEFT -> 0xA2
        KeyEvent.KEYCODE_CTRL_RIGHT -> 0xA3
        KeyEvent.KEYCODE_ALT_LEFT -> 0xA4
        KeyEvent.KEYCODE_ALT_RIGHT -> 0xA5
        KeyEvent.KEYCODE_META_LEFT -> 0x5B
        KeyEvent.KEYCODE_META_RIGHT -> 0x5C
        KeyEvent.KEYCODE_DPAD_LEFT -> 0x25
        KeyEvent.KEYCODE_DPAD_UP -> 0x26
        KeyEvent.KEYCODE_DPAD_RIGHT -> 0x27
        KeyEvent.KEYCODE_DPAD_DOWN -> 0x28
        KeyEvent.KEYCODE_MINUS -> 0xBD
        KeyEvent.KEYCODE_EQUALS -> 0xBB
        KeyEvent.KEYCODE_LEFT_BRACKET -> 0xDB
        KeyEvent.KEYCODE_RIGHT_BRACKET -> 0xDD
        KeyEvent.KEYCODE_BACKSLASH -> 0xDC
        KeyEvent.KEYCODE_SEMICOLON -> 0xBA
        KeyEvent.KEYCODE_APOSTROPHE -> 0xDE
        KeyEvent.KEYCODE_GRAVE -> 0xC0
        KeyEvent.KEYCODE_COMMA -> 0xBC
        KeyEvent.KEYCODE_PERIOD -> 0xBE
        KeyEvent.KEYCODE_SLASH -> 0xBF
        in KeyEvent.KEYCODE_F1..KeyEvent.KEYCODE_F12 -> 0x70 + (code - KeyEvent.KEYCODE_F1)
        in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> 0x60 + (code - KeyEvent.KEYCODE_NUMPAD_0)
        else -> null
    }
}
