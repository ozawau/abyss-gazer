package com.abyssgazer.desktop

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Process
import android.provider.DocumentsContract
import android.provider.Settings
import android.widget.Toast
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import java.io.File

/**
 * System folder picker for the data directory. Tauri's dialog plugin does not
 * implement directory selection on Android, and the database needs a real path.
 *
 * The document-tree picker opens immediately. All-files access is requested
 * only after the chosen path cannot be written.
 */
object DirectoryPicker {
    const val STATE_PENDING = "pending"
    const val STATE_CANCEL = "cancel"

    @JvmField
    var state: String = ""

    private var treeLauncher: ActivityResultLauncher<Intent>? = null
    private var accessLauncher: ActivityResultLauncher<Intent>? = null
    private var permissionLauncher: ActivityResultLauncher<String>? = null
    private var pendingPath: String? = null
    private var attempt = 0

    fun attach(
        treeLauncher: ActivityResultLauncher<Intent>,
        accessLauncher: ActivityResultLauncher<Intent>,
        permissionLauncher: ActivityResultLauncher<String>,
    ) {
        this.treeLauncher = treeLauncher
        this.accessLauncher = accessLauncher
        this.permissionLauncher = permissionLauncher
    }

    @JvmStatic
    @Suppress("UNUSED_PARAMETER")
    fun launch(activity: Activity) {
        attempt += 1
        pendingPath = null
        state = STATE_PENDING
        openTree()
    }

    fun onPickerResult(activity: Activity, result: ActivityResult) {
        if (state != STATE_PENDING) return
        if (result.resultCode != Activity.RESULT_OK) {
            state = STATE_CANCEL
            return
        }
        val uri = result.data?.data
        if (uri == null) {
            state = STATE_CANCEL
            return
        }
        val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            activity.contentResolver.takePersistableUriPermission(uri, flags)
        } catch (_: SecurityException) {
            // The resolved filesystem path is what the database uses.
        }
        val path = treeUriToPath(uri)
        if (path == null) {
            state = "error:无法使用所选目录"
            return
        }
        acceptPath(activity, path)
    }

    fun onStorageAccessResult(activity: Activity) {
        val path = pendingPath
        val current = attempt
        if (path == null) {
            if (state == STATE_PENDING) state = "error:无法使用所选目录"
            return
        }
        activity.window.decorView.postDelayed({
            if (current != attempt || state != STATE_PENDING) return@postDelayed
            if (!tryUseDirectory(path)) {
                state = "error:没有写入所选目录的权限。请允许访问所有文件后再试"
            }
        }, 500)
    }

    fun onWritePermissionResult(granted: Boolean) {
        val path = pendingPath
        if (path != null && tryUseDirectory(path)) return
        state = if (granted) {
            "error:没有写入所选目录的权限"
        } else {
            "error:需要存储权限后才能使用所选目录"
        }
    }

    private fun acceptPath(activity: Activity, path: String) {
        pendingPath = path
        if (tryUseDirectory(path)) return
        if (askForWriteAccess(activity)) return
        state = "error:没有写入所选目录的权限"
    }

    private fun tryUseDirectory(path: String): Boolean {
        val dir = File(path)
        try {
            if (!dir.exists() && !dir.mkdirs()) return false
            val probe = File(dir, ".abyss-gazer-write-test")
            probe.writeText("ok")
            if (!probe.delete()) probe.deleteOnExit()
        } catch (_: Exception) {
            return false
        }
        pendingPath = null
        state = "ok:$path"
        return true
    }

    private fun askForWriteAccess(activity: Activity): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !hasAllFilesAccess(activity)) {
            Toast.makeText(
                activity,
                "要保存到这个目录，请打开「允许访问所有文件」",
                Toast.LENGTH_LONG,
            ).show()
            return openAccessSettings(activity)
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            val launch = permissionLauncher ?: return false
            return try {
                launch.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                true
            } catch (_: Exception) {
                false
            }
        }
        return false
    }

    private fun openTree() {
        val launch = treeLauncher
        if (launch == null) {
            state = "error:目录选择器尚未就绪"
            return
        }
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
        }
        try {
            launch.launch(intent)
        } catch (_: Exception) {
            state = "error:无法打开目录选择器"
        }
    }

    private fun openAccessSettings(activity: Activity): Boolean {
        val launch = accessLauncher ?: return false
        val specific = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).apply {
            data = Uri.fromParts("package", activity.packageName, null)
        }
        return try {
            launch.launch(specific)
            true
        } catch (_: Exception) {
            try {
                launch.launch(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                true
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun hasAllFilesAccess(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return true
        if (Environment.isExternalStorageManager()) return true
        return try {
            val appOps = context.getSystemService(AppOpsManager::class.java) ?: return false
            val mode = appOps.unsafeCheckOpNoThrow(
                "android:manage_external_storage",
                Process.myUid(),
                context.packageName,
            )
            mode == AppOpsManager.MODE_ALLOWED
        } catch (_: Exception) {
            false
        }
    }

    private fun treeUriToPath(uri: Uri): String? {
        val docId = try {
            DocumentsContract.getTreeDocumentId(uri)
        } catch (_: Exception) {
            return null
        }
        val split = docId.split(":", limit = 2)
        if (split.size != 2) return null
        val volume = split[0]
        val relative = split[1].trim('/')
        val root = if (volume.equals("primary", ignoreCase = true)) {
            Environment.getExternalStorageDirectory().absolutePath
        } else {
            "/storage/$volume"
        }
        return if (relative.isEmpty()) root else "$root/$relative"
    }
}
