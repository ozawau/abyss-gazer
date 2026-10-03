package com.abyssgazer.desktop

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var backCallback: OnBackPressedCallback? = null
  private var webView: WebView? = null
  private var sawResume = false
  private val directoryPicker =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      DirectoryPicker.onPickerResult(this, result)
    }

  private val storageAccess =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
      DirectoryPicker.onStorageAccessResult(this)
    }

  private val writePermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      DirectoryPicker.onWritePermissionResult(granted)
    }

  private val notificationPermission =
    registerForActivityResult(ActivityResultContracts.RequestPermission()) { _ -> }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    active = this
    backCallback?.remove()
    val callback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(
          """
          (function(){
            try {
              if (typeof window.__abyssHandleBack === 'function') {
                return window.__abyssHandleBack();
              }
            } catch (e) {}
            return 'exit';
          })()
          """.trimIndent()
        ) { raw ->
          if (raw?.trim()?.removeSurrounding("\"") == "exit") {
            runOnUiThread { finish() }
          }
        }
      }
    }
    backCallback = callback
    onBackPressedDispatcher.addCallback(this, callback)
    if (intent?.getBooleanExtra(CheckinWidgetProvider.EXTRA_OPEN_CHECKIN, false) == true) {
      openCheckin(webView)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.getBooleanExtra(CheckinWidgetProvider.EXTRA_OPEN_CHECKIN, false)) {
      webView?.let { openCheckin(it) }
    }
  }

  private fun openCheckin(webView: WebView) {
    val habitId = intent?.getStringExtra(CheckinWidgetProvider.EXTRA_HABIT_ID)
    intent?.removeExtra(CheckinWidgetProvider.EXTRA_OPEN_CHECKIN)
    intent?.removeExtra(CheckinWidgetProvider.EXTRA_HABIT_ID)
    val habitLiteral = habitId?.let { org.json.JSONObject.quote(it) } ?: "null"
    webView.evaluateJavascript(
      """
      (function(){
        window.__abyssPendingCheckin = true;
        window.__abyssPendingCheckinHabit = $habitLiteral;
        var tries = 0;
        function fire(){
          if (window.__abyssCheckinReady) {
            window.__abyssPendingCheckin = false;
            window.dispatchEvent(new Event('abyss-open-checkin'));
            if (window.__abyssPendingCheckinHabit) {
              window.dispatchEvent(new CustomEvent('abyss-open-checkin-habit', {
                detail: { habitId: window.__abyssPendingCheckinHabit }
              }));
              window.__abyssPendingCheckinHabit = null;
            }
            return;
          }
          if (++tries > 40) return;
          setTimeout(fire, 250);
        }
        fire();
      })()
      """.trimIndent(),
      null,
    )
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    DirectoryPicker.attach(directoryPicker, storageAccess, writePermission)
    requestNotificationPermissionIfNeeded()
    applyTopSystemBarInset()
  }

  private fun requestNotificationPermissionIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (ContextCompat.checkSelfPermission(
        this,
        Manifest.permission.POST_NOTIFICATIONS,
      ) == PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
  }

  override fun onPause() {
    webView?.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new Event('abyss-background'))",
        null,
      )
    }
    super.onPause()
  }

  override fun onResume() {
    super.onResume()
    CheckinWidgetProvider.refresh(this)
    NoteTaskWidgetProvider.refresh(this)
    if (!sawResume) {
      sawResume = true
      return
    }
    webView?.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new Event('abyss-foreground'))",
        null,
      )
    }
  }

  private fun applyTopSystemBarInset() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      view.setPadding(0, bars.top, 0, 0)
      // The WebView also turns this top inset into safe-area-inset-top.
      // Leaving it in place adds a second blank row under the status bar.
      insets.inset(0, bars.top, 0, 0)
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onDestroy() {
    if (active === this) active = null
    super.onDestroy()
    webView = null
  }

  companion object {
    private var active: MainActivity? = null

    fun notifyCheckinChanged() {
      val webView = active?.webView ?: return
      webView.post {
        webView.evaluateJavascript(
          "window.dispatchEvent(new Event('abyss-checkin-changed'))",
          null,
        )
      }
    }
  }
}
