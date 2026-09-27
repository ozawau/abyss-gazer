package com.abyssgazer.desktop

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var backCallback: OnBackPressedCallback? = null
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

  override fun onWebViewCreate(webView: WebView) {
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
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    DirectoryPicker.attach(directoryPicker, storageAccess, writePermission)
    applyTopSystemBarInset()
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
}
