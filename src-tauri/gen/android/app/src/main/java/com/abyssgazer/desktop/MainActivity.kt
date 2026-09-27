package com.abyssgazer.desktop

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
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
