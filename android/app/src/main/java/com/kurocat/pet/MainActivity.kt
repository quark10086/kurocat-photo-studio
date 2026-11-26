package com.kurocat.pet

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import kotlin.math.roundToInt

class MainActivity : AppCompatActivity(), KuroPetListener {

    private var previewWebView: WebView? = null
    private var previewReady = false

    private lateinit var overlayStatusBadge: TextView
    private lateinit var overlayPermBtn: TextView
    private lateinit var a11yStatusBadge: TextView
    private lateinit var a11yPermBtn: TextView
    private lateinit var mainToggleBtn: TextView
    private lateinit var scaleValueText: TextView
    private lateinit var scaleSeekBar: SeekBar
    private lateinit var swTouchThrough: SwitchCompat
    private lateinit var swPrivacy: SwitchCompat
    private lateinit var swBubbles: SwitchCompat
    private lateinit var swSound: SwitchCompat

    private val skinButtons = mutableMapOf<String, TextView>()
    private lateinit var btnLayout65: TextView
    private lateinit var btnLayout108: TextView
    private lateinit var btnOrientCat: TextView
    private lateinit var btnOrientViewer: TextView

    private var inAppPrivacyActive = false
    private var updatingUi = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(buildUi())
        KuroEventBus.register(this)
        requestNotificationPermissionIfNeeded()
        refreshAllUi()
    }

    override fun onResume() {
        super.onResume()
        previewWebView?.onResume()
        refreshAllUi()
    }

    override fun onPause() {
        previewWebView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        KuroEventBus.unregister(this)
        previewWebView?.destroy()
        previewWebView = null
        super.onDestroy()
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics)
            .roundToInt()

    private fun roundedBg(fill: Int, radiusDp: Int, strokeColor: Int = 0, strokeDp: Int = 0): GradientDrawable {
        return GradientDrawable().apply {
            setColor(fill)
            cornerRadius = dp(radiusDp).toFloat()
            if (strokeDp > 0) setStroke(dp(strokeDp), strokeColor)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
            }
        }
    }

    private fun isAccessibilityEnabled(): Boolean {
        if (KuroEventBus.accessibilityConnected.get()) return true
        val expected = ComponentName(this, KuroAccessibilityService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildUi(): View {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(0xFF0B0E15.toInt())
            isFillViewport = true
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(20), dp(18), dp(28))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            v.setPadding(
                dp(18) + bars.left,
                dp(16) + bars.top,
                dp(18) + bars.right,
                dp(28) + bars.bottom
            )
            insets
        }
        scroll.addView(
            root,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        )

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val titleCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        titleCol.addView(TextView(this).apply {
            text = "🐈‍⬛ KuroCat Android"
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 23f
            typeface = Typeface.DEFAULT_BOLD
        })
        titleCol.addView(TextView(this).apply {
            text = "v4.9.0 · 透明悬浮打字桌宠 · 免费开源"
            setTextColor(0xFF8F9DB5.toInt())
            textSize = 12.5f
            setPadding(0, dp(2), 0, 0)
        })
        header.addView(titleCol)
        header.addView(TextView(this).apply {
            text = "7款皮肤"
            setTextColor(0xFF0B0E15.toInt())
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg(0xFFC8F538.toInt(), 99)
            setPadding(dp(11), dp(5), dp(11), dp(5))
        })
        root.addView(header)

        // Live Interactive Preview Card (mount WebView right after first frame so app opens instantaneously!)
        val previewCard = FrameLayout(this).apply {
            background = roundedBg(0xFF131824.toInt(), 20, 0x33FFFFFF, 1)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(235)).apply {
                topMargin = dp(14)
            }
        }
        val loadingLabel = TextView(this).apply {
            text = "🐈‍⬛ 正在唤醒小黑猫..."
            setTextColor(0xFF8F9DB5.toInt())
            textSize = 13.5f
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
        }
        previewCard.addView(loadingLabel)
        val previewBadge = TextView(this).apply {
            text = "实时预览 · 点猫头可摸头呼噜"
            setTextColor(0xFFA9B7CE.toInt())
            textSize = 11.5f
            background = roundedBg(0x9910141F.toInt(), 99, 0x26FFFFFF, 1)
            setPadding(dp(10), dp(4), dp(10), dp(4))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.START
            ).apply {
                setMargins(dp(12), dp(10), 0, 0)
            }
        }
        previewCard.addView(previewBadge)
        previewCard.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
                .build()
            val wv = WebView(this).apply {
                setBackgroundColor(Color.TRANSPARENT)
                overScrollMode = View.OVER_SCROLL_NEVER
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
                        previewReady = true
                        loadingLabel.visibility = View.GONE
                        android.util.Log.i("KuroCat", "previewReady url=$url")
                        syncPreviewJs()
                    }
                }
                loadUrl("https://appassets.androidplatform.net/assets/web/android-web.html")
                setOnClickListener {
                    evalPreviewJs("window.KuroAndroid && window.KuroAndroid.petHead();")
                }
            }
            previewWebView = wv
            previewCard.addView(
                wv,
                0,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }, 120L)
        root.addView(previewCard)

        // Primary Start / Stop Floating Pet Button
        mainToggleBtn = TextView(this).apply {
            text = "🚀 开启桌面悬浮桌宠"
            gravity = Gravity.CENTER
            textSize = 16.5f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFF0B0E15.toInt())
            background = roundedBg(0xFFC8F538.toInt(), 16)
            setPadding(dp(16), dp(15), dp(16), dp(15))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(14)
            }
            setOnClickListener { onClickMainToggle() }
        }
        root.addView(mainToggleBtn)

        // 2-Step Permission Setup Card
        val permCard = makeCard(root, "两步开启完整体验（仅首次需要）")
        val (ovBadge, ovBtn) = addPermissionRow(
            permCard,
            "1. 悬浮窗权限",
            "让小猫 / 鲸鱼娘透明置顶显示在微信、小红书、桌面等任意页面上层",
            "去开启"
        ) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            )
            startActivity(intent)
        }
        overlayStatusBadge = ovBadge
        overlayPermBtn = ovBtn

        addDivider(permCard)

        val (a11yBadge, a11yBtn) = addPermissionRow(
            permCard,
            "2. 无障碍打字联动（推荐）",
            "感知任意 App 打字节奏与密码框自动闭眼捂眼（绝不读取/上传文本）",
            "去开启"
        ) {
            Toast.makeText(this, "请在「已下载的应用 / 已安装的服务」中开启 KuroCat", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        a11yStatusBadge = a11yBadge
        a11yPermBtn = a11yBtn

        // Skin Picker Card
        val skinCard = makeCard(root, "切换外观（6 款猫咪 + 🐳 大肥鱼鲸鱼娘）")
        val skinScroll = HorizontalScrollView(this).apply {
            isHorizontalScrollBarEnabled = false
        }
        val skinRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        KuroPrefs.SKINS.forEachIndexed { idx, skin ->
            val btn = TextView(this).apply {
                text = "${skin.emoji} ${skin.name}"
                textSize = 13.5f
                typeface = Typeface.DEFAULT_BOLD
                setPadding(dp(14), dp(9), dp(14), dp(9))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply {
                    if (idx > 0) leftMargin = dp(8)
                }
                setOnClickListener {
                    KuroPrefs.setBreed(this@MainActivity, skin.id)
                    KuroEventBus.postSettingsChanged()
                    refreshAllUi()
                }
            }
            skinButtons[skin.id] = btn
            skinRow.addView(btn)
        }
        skinScroll.addView(skinRow)
        skinCard.addView(skinScroll)

        // Keyboard Layout & Scale Card
        val styleCard = makeCard(root, "键盘配列、方向与悬浮大小")

        val segRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        btnLayout65 = makeSegButton("65% 紧凑") {
            KuroPrefs.setLayout(this, "65")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnLayout108 = makeSegButton("108 全尺寸") {
            KuroPrefs.setLayout(this, "108")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnOrientCat = makeSegButton("面向猫咪") {
            KuroPrefs.setOrientation(this, "cat")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        btnOrientViewer = makeSegButton("面向观众") {
            KuroPrefs.setOrientation(this, "viewer")
            KuroEventBus.postSettingsChanged()
            refreshAllUi()
        }
        segRow.addView(btnLayout65)
        segRow.addView(btnLayout108)
        segRow.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(dp(8), 1) })
        segRow.addView(btnOrientCat)
        segRow.addView(btnOrientViewer)
        styleCard.addView(segRow)

        val scaleHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(16)
            }
        }
        scaleHeader.addView(TextView(this).apply {
            text = "悬浮桌宠缩放大小"
            setTextColor(0xFFE6ECF7.toInt())
            textSize = 14f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        scaleValueText = TextView(this).apply {
            text = "78%"
            setTextColor(0xFFC8F538.toInt())
            textSize = 13.5f
            typeface = Typeface.DEFAULT_BOLD
        }
        scaleHeader.addView(scaleValueText)
        styleCard.addView(scaleHeader)

        scaleSeekBar = SeekBar(this).apply {
            max = 105 // 35..140 -> progress + 35
            progress = (KuroPrefs.getScale(this@MainActivity) * 100).roundToInt() - 35
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(6)
            }
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) {
                    val pct = (progress + 35).coerceIn(35, 140)
                    scaleValueText.text = "$pct%"
                    if (fromUser) {
                        KuroPrefs.setScale(this@MainActivity, pct / 100f)
                        KuroEventBus.postSettingsChanged()
                    }
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) {}
                override fun onStopTrackingTouch(seekBar: SeekBar?) {}
            })
        }
        styleCard.addView(scaleSeekBar)

        // Switches Card
        val switchCard = makeCard(root, "互动与隐私开关")
        swTouchThrough = addSwitchRow(
            switchCard,
            "🔒 锁定触摸穿透（不挡打字与点击）",
            "开启后手指可穿透小猫操作下方 App；下拉通知栏点「解锁穿透」即可随时拖动"
        ) { checked ->
            KuroPrefs.setTouchThroughLocked(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swPrivacy = addSwitchRow(
            switchCard,
            "🙈 输密码自动闭眼 / 捂眼防偷窥",
            "切入密码输入框时猫咪自动闭眼、大肥鱼双手捂眼并隐藏按键气泡"
        ) { checked ->
            KuroPrefs.setPrivacyGuardEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swBubbles = addSwitchRow(
            switchCard,
            "💬 显示悬浮 3D 按键气泡",
            "敲击键盘时在头顶弹出可爱键帽气泡"
        ) { checked ->
            KuroPrefs.setShowKeyBubbles(this, checked)
            KuroEventBus.postSettingsChanged()
        }
        addDivider(switchCard)
        swSound = addSwitchRow(
            switchCard,
            "🔊 摸头呼噜声",
            "单击悬浮小猫或预览画布摸头时播放温柔呼噜声"
        ) { checked ->
            KuroPrefs.setSoundEnabled(this, checked)
            KuroEventBus.postSettingsChanged()
        }

        // Built-in Live Test Card (works immediately even before enabling Accessibility!)
        val testCard = makeCard(root, "现场测试打字 & 密码捂眼")
        val normalInput = EditText(this).apply {
            hint = "在这里随便打几个字，看看上方小猫/鲸鱼娘同步敲键盘…"
            setHintTextColor(0xFF6B7791.toInt())
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 13.5f
            background = roundedBg(0xFF0D111A.toInt(), 12, 0x2EFFFFFF, 1)
            setPadding(dp(12), dp(11), dp(12), dp(11))
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    inAppPrivacyActive = false
                    KuroEventBus.postPrivacyChanged(false)
                    if (count == 0 && before > 0) {
                        KuroEventBus.postTypingBurst(1, "delete")
                    } else if (count > 0) {
                        KuroEventBus.postTypingBurst(count.coerceAtMost(3), "char")
                    }
                }
                override fun afterTextChanged(s: Editable?) {}
            })
            setOnFocusChangeListener { _, hasFocus ->
                if (hasFocus) {
                    inAppPrivacyActive = false
                    KuroEventBus.postPrivacyChanged(false)
                }
            }
        }
        testCard.addView(normalInput)

        val pwdInput = EditText(this).apply {
            hint = "点这里测试输入密码：猫咪自动闭眼 / 大肥鱼捂眼…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setHintTextColor(0xFF6B7791.toInt())
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 13.5f
            background = roundedBg(0xFF0D111A.toInt(), 12, 0x33FFD859, 1)
            setPadding(dp(12), dp(11), dp(12), dp(11))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(10)
            }
            setOnFocusChangeListener { _, hasFocus ->
                inAppPrivacyActive = hasFocus
                KuroEventBus.postPrivacyChanged(hasFocus && KuroPrefs.isPrivacyGuardEnabled(this@MainActivity))
            }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if (KuroPrefs.isPrivacyGuardEnabled(this@MainActivity)) {
                        inAppPrivacyActive = true
                        KuroEventBus.postPrivacyChanged(true)
                        KuroEventBus.postPrivacyTyping()
                    }
                }
                override fun afterTextChanged(s: Editable?) {}
            })
        }
        testCard.addView(pwdInput)

        // Footer Tip
        root.addView(TextView(this).apply {
            text = "悬浮手势：按住拖动移位 · 单击猫头摸头呼噜 · 双击打开设置\n免费开源 · 官网：qianyi.one/kurocat"
            gravity = Gravity.CENTER
            setTextColor(0xFF6F7B94.toInt())
            textSize = 11.5f
            setLineSpacing(dp(3).toFloat(), 1f)
            setPadding(0, dp(16), 0, dp(6))
        })

        return scroll
    }

    private fun makeCard(parent: LinearLayout, title: String): LinearLayout {
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedBg(0xFF141926.toInt(), 18, 0x22FFFFFF, 1)
            setPadding(dp(15), dp(14), dp(15), dp(14))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(14)
            }
        }
        card.addView(TextView(this).apply {
            text = title
            setTextColor(0xFF9FB0CB.toInt())
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(10))
        })
        parent.addView(card)
        return card
    }

    private fun addDivider(parent: LinearLayout) {
        parent.addView(View(this).apply {
            setBackgroundColor(0x18FFFFFF)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                topMargin = dp(10)
                bottomMargin = dp(10)
            }
        })
    }

    private fun addPermissionRow(
        parent: LinearLayout,
        title: String,
        desc: String,
        btnText: String,
        onClick: () -> Unit
    ): Pair<TextView, TextView> {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(10)
            }
        }
        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        titleRow.addView(TextView(this).apply {
            text = title
            setTextColor(0xFFF4F6FA.toInt())
            textSize = 14.5f
            typeface = Typeface.DEFAULT_BOLD
        })
        val badge = TextView(this).apply {
            text = "未开启"
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(7), dp(2), dp(7), dp(2))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                leftMargin = dp(8)
            }
        }
        titleRow.addView(badge)
        col.addView(titleRow)
        col.addView(TextView(this).apply {
            text = desc
            setTextColor(0xFF8C9AB3.toInt())
            textSize = 12f
            setPadding(0, dp(3), 0, 0)
        })
        row.addView(col)

        val btn = TextView(this).apply {
            text = btnText
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(12), dp(7), dp(12), dp(7))
            setOnClickListener { onClick() }
        }
        row.addView(btn)
        parent.addView(row)
        return badge to btn
    }

    private fun makeSegButton(label: String, onClick: () -> Unit): TextView {
        return TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            textSize = 12.5f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(6), dp(9), dp(6), dp(9))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                setMargins(dp(2), 0, dp(2), 0)
            }
            setOnClickListener { onClick() }
        }
    }

    private fun addSwitchRow(
        parent: LinearLayout,
        title: String,
        desc: String,
        onToggle: (Boolean) -> Unit
    ): SwitchCompat {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(10)
            }
        }
        col.addView(TextView(this).apply {
            text = title
            setTextColor(0xFFF0F4FA.toInt())
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
        })
        col.addView(TextView(this).apply {
            text = desc
            setTextColor(0xFF8795AE.toInt())
            textSize = 11.5f
            setPadding(0, dp(2), 0, 0)
        })
        row.addView(col)

        val sw = SwitchCompat(this).apply {
            setOnCheckedChangeListener { _, isChecked ->
                if (!updatingUi) onToggle(isChecked)
            }
        }
        row.addView(sw)
        parent.addView(row)
        return sw
    }

    private fun onClickMainToggle() {
        val running = KuroEventBus.overlayRunning.get()
        val canDraw = Settings.canDrawOverlays(this)
        android.util.Log.i("KuroCat", "onClickMainToggle running=$running canDraw=$canDraw")
        if (running) {
            KuroOverlayService.stop(this)
            refreshAllUi()
            return
        }
        if (!canDraw) {
            Toast.makeText(this, "请先授予「悬浮窗权限」后再开启悬浮桌宠", Toast.LENGTH_SHORT).show()
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
            return
        }
        KuroOverlayService.start(this)
        refreshAllUi()
    }

    private fun refreshAllUi() {
        updatingUi = true
        try {
            val hasOverlay = Settings.canDrawOverlays(this)
        val hasA11y = isAccessibilityEnabled()
        val running = KuroEventBus.overlayRunning.get()

        if (hasOverlay) {
            overlayStatusBadge.text = "✓ 已开启"
            overlayStatusBadge.setTextColor(0xFF0B0E15.toInt())
            overlayStatusBadge.background = roundedBg(0xFFC8F538.toInt(), 99)
            overlayPermBtn.text = "已就绪"
            overlayPermBtn.setTextColor(0xFF9AA8C0.toInt())
            overlayPermBtn.background = roundedBg(0x18FFFFFF, 10)
        } else {
            overlayStatusBadge.text = "必选"
            overlayStatusBadge.setTextColor(0xFFFFD859.toInt())
            overlayStatusBadge.background = roundedBg(0x26FFD859, 99)
            overlayPermBtn.text = "去开启"
            overlayPermBtn.setTextColor(0xFF0B0E15.toInt())
            overlayPermBtn.background = roundedBg(0xFFC8F538.toInt(), 10)
        }

        if (hasA11y) {
            a11yStatusBadge.text = "✓ 已开启"
            a11yStatusBadge.setTextColor(0xFF0B0E15.toInt())
            a11yStatusBadge.background = roundedBg(0xFF5CC8FF.toInt(), 99)
            a11yPermBtn.text = "已就绪"
            a11yPermBtn.setTextColor(0xFF9AA8C0.toInt())
            a11yPermBtn.background = roundedBg(0x18FFFFFF, 10)
        } else {
            a11yStatusBadge.text = "未开启"
            a11yStatusBadge.setTextColor(0xFF9AA8C0.toInt())
            a11yStatusBadge.background = roundedBg(0x1AFFFFFF, 99)
            a11yPermBtn.text = "去开启"
            a11yPermBtn.setTextColor(0xFF0B0E15.toInt())
            a11yPermBtn.background = roundedBg(0xFF5CC8FF.toInt(), 10)
        }

        if (running) {
            mainToggleBtn.text = "⏹ 关闭桌面悬浮桌宠"
            mainToggleBtn.setTextColor(0xFFFF9696.toInt())
            mainToggleBtn.background = roundedBg(0x2BFF5C5C, 16, 0x66FF5C5C, 1)
        } else {
            mainToggleBtn.text = "🚀 开启桌面悬浮桌宠"
            mainToggleBtn.setTextColor(0xFF0B0E15.toInt())
            mainToggleBtn.background = roundedBg(0xFFC8F538.toInt(), 16)
        }

        val curBreed = KuroPrefs.getBreed(this)
        KuroPrefs.SKINS.forEach { skin ->
            val tv = skinButtons[skin.id] ?: return@forEach
            if (skin.id == curBreed) {
                tv.setTextColor(0xFF0B0E15.toInt())
                tv.background = roundedBg(skin.accentHex, 12)
            } else {
                tv.setTextColor(0xFFDCE4F2.toInt())
                tv.background = roundedBg(0x14FFFFFF, 12, 0x22FFFFFF, 1)
            }
        }

        val is108 = KuroPrefs.getLayout(this) == "108"
        styleSeg(btnLayout65, !is108)
        styleSeg(btnLayout108, is108)
        val isViewer = KuroPrefs.getOrientation(this) == "viewer"
        styleSeg(btnOrientCat, !isViewer)
        styleSeg(btnOrientViewer, isViewer)

        val pct = (KuroPrefs.getScale(this) * 100).roundToInt()
        scaleValueText.text = "$pct%"
        if (scaleSeekBar.progress != pct - 35) {
            scaleSeekBar.progress = (pct - 35).coerceIn(0, 105)
        }

        if (swTouchThrough.isChecked != KuroPrefs.isTouchThroughLocked(this)) {
            swTouchThrough.isChecked = KuroPrefs.isTouchThroughLocked(this)
        }
        if (swPrivacy.isChecked != KuroPrefs.isPrivacyGuardEnabled(this)) {
            swPrivacy.isChecked = KuroPrefs.isPrivacyGuardEnabled(this)
        }
        if (swBubbles.isChecked != KuroPrefs.isShowKeyBubbles(this)) {
            swBubbles.isChecked = KuroPrefs.isShowKeyBubbles(this)
        }
        if (swSound.isChecked != KuroPrefs.isSoundEnabled(this)) {
            swSound.isChecked = KuroPrefs.isSoundEnabled(this)
        }
        } finally {
            updatingUi = false
        }

        syncPreviewJs()
    }

    private fun styleSeg(tv: TextView, active: Boolean) {
        if (active) {
            tv.setTextColor(0xFF0B0E15.toInt())
            tv.background = roundedBg(0xFFC8F538.toInt(), 10)
        } else {
            tv.setTextColor(0xFFD1DAEB.toInt())
            tv.background = roundedBg(0x14FFFFFF, 10)
        }
    }

    private fun evalPreviewJs(script: String) {
        if (!previewReady) return
        previewWebView?.evaluateJavascript(script, null)
    }

    private fun syncPreviewJs() {
        val json = KuroPrefs.toJsJson(this, inAppPrivacyActive || KuroEventBus.privacyActive.get())
        val escaped = JSONObject.quote(json)
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.setSettings($escaped);")
    }

    override fun onTypingBurst(count: Int, kind: String) {
        val safeKind = JSONObject.quote(kind)
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onTypingBurst($count, $safeKind);")
    }

    override fun onHardwareKey(vk: Int, isDown: Boolean, repeat: Boolean) {
        if (isDown) {
            evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onKeyDown($vk, $repeat);")
        } else {
            evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onKeyUp($vk);")
        }
    }

    override fun onPrivacyChanged(active: Boolean) {
        val effective = active && KuroPrefs.isPrivacyGuardEnabled(this)
        evalPreviewJs("window.KuroAndroid && window.KuroAndroid.setPrivacyMode($effective);")
    }

    override fun onPrivacyTyping() {
        if (KuroPrefs.isPrivacyGuardEnabled(this)) {
            evalPreviewJs("window.KuroAndroid && window.KuroAndroid.onPrivacyTyping();")
        }
    }

    override fun onSettingsChanged() {
        refreshAllUi()
    }

    override fun onOverlayStateChanged(running: Boolean) {
        refreshAllUi()
    }
}
