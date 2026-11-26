package com.kurocat.pet

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

class KuroOverlayService : Service(), KuroPetListener {

    companion object {
        private const val CHANNEL_ID = "kurocat_overlay_channel"
        private const val NOTIF_ID = 4701

        const val ACTION_START = "com.kurocat.pet.ACTION_START"
        const val ACTION_STOP = "com.kurocat.pet.ACTION_STOP"
        const val ACTION_TOGGLE_LOCK = "com.kurocat.pet.ACTION_TOGGLE_LOCK"
        const val ACTION_NEXT_SKIN = "com.kurocat.pet.ACTION_NEXT_SKIN"
        const val ACTION_TOGGLE_VISIBLE = "com.kurocat.pet.ACTION_TOGGLE_VISIBLE"

        fun start(ctx: Context) {
            val intent = Intent(ctx, KuroOverlayService::class.java).setAction(ACTION_START)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, KuroOverlayService::class.java))
        }
    }

    private lateinit var windowManager: WindowManager
    private var rootView: FrameLayout? = null
    private var webView: WebView? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var pageReady = false
    private var petHidden = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        ensureNotificationChannel()
        startForegroundWithNotification()
        KuroEventBus.register(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_TOGGLE_LOCK -> {
                val next = !KuroPrefs.isTouchThroughLocked(this)
                KuroPrefs.setTouchThroughLocked(this, next)
                applyOverlayWindowFlags()
                updateNotification()
                KuroEventBus.postSettingsChanged()
                return START_STICKY
            }
            ACTION_NEXT_SKIN -> {
                KuroPrefs.nextBreed(this)
                syncSettingsToJs()
                updateNotification()
                KuroEventBus.postSettingsChanged()
                return START_STICKY
            }
            ACTION_TOGGLE_VISIBLE -> {
                petHidden = !petHidden
                rootView?.visibility = if (petHidden) View.GONE else View.VISIBLE
                updateNotification()
                return START_STICKY
            }
        }

        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return START_NOT_STICKY
        }

        if (rootView == null) {
            attachOverlayWindow()
        } else {
            petHidden = false
            rootView?.visibility = View.VISIBLE
            applyOverlayWindowFlags()
            applyOverlaySize()
            syncSettingsToJs()
            updateNotification()
        }
        KuroEventBus.postOverlayStateChanged(true)
        return START_STICKY
    }

    override fun onDestroy() {
        KuroEventBus.unregister(this)
        KuroEventBus.postOverlayStateChanged(false)
        detachOverlayWindow()
        super.onDestroy()
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            val ch = NotificationChannel(
                CHANNEL_ID,
                "KuroCat 悬浮桌宠常驻服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "保持悬浮小猫置顶显示，并在通知栏提供一键解锁穿透与切换皮肤快捷按钮"
                setShowBadge(false)
            }
            nm.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): Notification {
        val openAppIntent = PendingIntent.getActivity(
            this,
            10,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val locked = KuroPrefs.isTouchThroughLocked(this)
        val lockPi = PendingIntent.getService(
            this,
            11,
            Intent(this, KuroOverlayService::class.java).setAction(ACTION_TOGGLE_LOCK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val skinPi = PendingIntent.getService(
            this,
            12,
            Intent(this, KuroOverlayService::class.java).setAction(ACTION_NEXT_SKIN),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val visPi = PendingIntent.getService(
            this,
            13,
            Intent(this, KuroOverlayService::class.java).setAction(ACTION_TOGGLE_VISIBLE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val curSkin = KuroPrefs.SKINS.find { it.id == KuroPrefs.getBreed(this) } ?: KuroPrefs.SKINS[0]
        val statusText = when {
            petHidden -> "已隐藏 · 点击通知栏「显示」恢复"
            locked -> "已锁定触摸穿透（不挡操作）· 下拉点「解锁穿透」即可拖动"
            else -> "当前外观：${curSkin.emoji} ${curSkin.name} · 单击摸头 · 拖动移位 · 双击设置"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_kurocat)
            .setContentTitle("KuroCat 桌宠运行中")
            .setContentText(statusText)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openAppIntent)
            .addAction(0, if (locked) "解锁穿透" else "锁定穿透", lockPi)
            .addAction(0, "换皮肤", skinPi)
            .addAction(0, if (petHidden) "显示" else "隐藏", visPi)
            .build()
    }

    private fun startForegroundWithNotification() {
        val notif = buildNotification()
        val fgsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIF_ID, notif, fgsType)
    }

    private fun updateNotification() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, buildNotification())
    }

    private fun computeOverlaySizePx(): Pair<Int, Int> {
        val density = resources.displayMetrics.density
        val scale = KuroPrefs.getScale(this)
        val is108 = KuroPrefs.getLayout(this) == "108"
        val baseWdp = if (is108) 270f else 210f
        val baseHdp = if (is108) 228f else 220f
        val w = (baseWdp * scale * density).roundToInt().coerceAtLeast((90 * density).roundToInt())
        val h = (baseHdp * scale * density).roundToInt().coerceAtLeast((95 * density).roundToInt())
        return w to h
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun attachOverlayWindow() {
        val dm = resources.displayMetrics
        val (wPx, hPx) = computeOverlaySizePx()
        val defaultX = (dm.widthPixels - wPx - (12 * dm.density).roundToInt()).coerceAtLeast(0)
        val defaultY = (dm.heightPixels - hPx - (160 * dm.density).roundToInt()).coerceAtLeast(0)
        val initX = KuroPrefs.getOverlayX(this, defaultX).coerceIn(0, (dm.widthPixels - wPx).coerceAtLeast(0))
        val initY = KuroPrefs.getOverlayY(this, defaultY).coerceIn(0, (dm.heightPixels - hPx).coerceAtLeast(0))

        val locked = KuroPrefs.isTouchThroughLocked(this)
        var wmFlags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        if (locked) {
            wmFlags = wmFlags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        }

        val lp = WindowManager.LayoutParams(
            wPx,
            hPx,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            wmFlags,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = initX
            y = initY
        }
        layoutParams = lp

        val container = object : FrameLayout(this) {
            override fun onInterceptTouchEvent(ev: MotionEvent?): Boolean = true
        }.apply {
            setBackgroundColor(Color.TRANSPARENT)
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val wv = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            overScrollMode = View.OVER_SCROLL_NEVER
            isHorizontalScrollBarEnabled = false
            isVerticalScrollBarEnabled = false
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                override fun onPageFinished(view: WebView?, url: String?) {
                    pageReady = true
                    android.util.Log.i("KuroCat", "overlayWebViewReady url=$url")
                    syncSettingsToJs()
                }
            }
            loadUrl("https://appassets.androidplatform.net/assets/web/android-web.html")
        }

        container.addView(
            wv,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        val dragSlop = 10f * dm.density
        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        var lastTapAt = 0L

        container.setOnTouchListener { _, ev ->
            val curLp = layoutParams ?: return@setOnTouchListener false
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = ev.rawX
                    downRawY = ev.rawY
                    startX = curLp.x
                    startY = curLp.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = ev.rawX - downRawX
                    val dy = ev.rawY - downRawY
                    if (!dragging && (abs(dx) > dragSlop || abs(dy) > dragSlop)) {
                        dragging = true
                    }
                    if (dragging) {
                        val metrics = resources.displayMetrics
                        val maxX = (metrics.widthPixels - curLp.width).coerceAtLeast(0)
                        val maxY = (metrics.heightPixels - curLp.height).coerceAtLeast(0)
                        curLp.x = (startX + dx).roundToInt().coerceIn(0, maxX)
                        curLp.y = (startY + dy).roundToInt().coerceIn(0, maxY)
                        try {
                            windowManager.updateViewLayout(container, curLp)
                        } catch (_: Throwable) {
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (dragging) {
                        KuroPrefs.setOverlayPos(this@KuroOverlayService, curLp.x, curLp.y)
                    } else {
                        val now = System.currentTimeMillis()
                        if (now - lastTapAt < 340L) {
                            lastTapAt = 0L
                            // Double-tap opens settings panel
                            startActivity(
                                Intent(this@KuroOverlayService, MainActivity::class.java)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            )
                        } else {
                            lastTapAt = now
                            // Single tap pets the cat / whale-girl!
                            evalJs("window.KuroAndroid && window.KuroAndroid.petHead();")
                        }
                    }
                    true
                }
                else -> false
            }
        }

        rootView = container
        webView = wv
        windowManager.addView(container, lp)
    }

    private fun detachOverlayWindow() {
        pageReady = false
        val root = rootView
        val wv = webView
        rootView = null
        webView = null
        layoutParams = null
        if (root != null) {
            try {
                windowManager.removeView(root)
            } catch (_: Throwable) {
            }
        }
        if (wv != null) {
            try {
                wv.stopLoading()
                wv.destroy()
            } catch (_: Throwable) {
            }
        }
    }

    private fun applyOverlayWindowFlags() {
        val root = rootView ?: return
        val lp = layoutParams ?: return
        val locked = KuroPrefs.isTouchThroughLocked(this)
        val base = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
        lp.flags = if (locked) base or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else base
        try {
            windowManager.updateViewLayout(root, lp)
        } catch (_: Throwable) {
        }
    }

    private fun applyOverlaySize() {
        val root = rootView ?: return
        val lp = layoutParams ?: return
        val (wPx, hPx) = computeOverlaySizePx()
        if (lp.width != wPx || lp.height != hPx) {
            val dm = resources.displayMetrics
            lp.width = wPx
            lp.height = hPx
            lp.x = lp.x.coerceIn(0, (dm.widthPixels - wPx).coerceAtLeast(0))
            lp.y = lp.y.coerceIn(0, (dm.heightPixels - hPx).coerceAtLeast(0))
            try {
                windowManager.updateViewLayout(root, lp)
            } catch (_: Throwable) {
            }
            evalJs("window.KuroAndroid && window.KuroAndroid.resize();")
        }
    }

    private fun evalJs(script: String) {
        if (!pageReady) return
        webView?.evaluateJavascript(script, null)
    }

    private fun syncSettingsToJs() {
        val json = KuroPrefs.toJsJson(this, KuroEventBus.privacyActive.get())
        val escaped = JSONObject.quote(json)
        evalJs("window.KuroAndroid && window.KuroAndroid.setSettings($escaped);")
    }

    override fun onTypingBurst(count: Int, kind: String) {
        if (petHidden) return
        val safeKind = JSONObject.quote(kind)
        evalJs("window.KuroAndroid && window.KuroAndroid.onTypingBurst($count, $safeKind);")
    }

    override fun onHardwareKey(vk: Int, isDown: Boolean, repeat: Boolean) {
        if (petHidden) return
        if (isDown) {
            evalJs("window.KuroAndroid && window.KuroAndroid.onKeyDown($vk, $repeat);")
        } else {
            evalJs("window.KuroAndroid && window.KuroAndroid.onKeyUp($vk);")
        }
    }

    override fun onScreenTap(nx: Float, ny: Float) {
        if (petHidden) return
        evalJs("window.KuroAndroid && window.KuroAndroid.onScreenTap($nx, $ny, false);")
    }

    override fun onPrivacyChanged(active: Boolean) {
        val effective = active && KuroPrefs.isPrivacyGuardEnabled(this)
        evalJs("window.KuroAndroid && window.KuroAndroid.setPrivacyMode($effective);")
    }

    override fun onPrivacyTyping() {
        if (KuroPrefs.isPrivacyGuardEnabled(this)) {
            evalJs("window.KuroAndroid && window.KuroAndroid.onPrivacyTyping();")
        }
    }

    override fun onSettingsChanged() {
        applyOverlayWindowFlags()
        applyOverlaySize()
        syncSettingsToJs()
        updateNotification()
    }
}
