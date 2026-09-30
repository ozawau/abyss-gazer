package com.abyssgazer.desktop

import android.app.Activity
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.widget.doAfterTextChanged
import kotlin.math.max

/** Bottom overlay for widget draft input (fallback when launcher has no widget RemoteInput). */
class NoteTaskInputActivity : Activity() {
    private lateinit var input: EditText
    private var skipDraftOnPause = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.note_task_overlay)
        val root = findViewById<View>(R.id.note_task_overlay_root)
        val bar = findViewById<View>(R.id.note_task_overlay_bar)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val system = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottom = max(system.bottom, ime.bottom)
            (bar.layoutParams as FrameLayout.LayoutParams).apply {
                bottomMargin = bottom
                bar.layoutParams = this
            }
            insets
        }
        ViewCompat.requestApplyInsets(root)
        root.setOnClickListener { finishQuietly() }
        bar.setOnClickListener { /* keep keyboard */ }
        input = findViewById(R.id.note_task_dialog_input)
        input.apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            setHorizontallyScrolling(true)
            isSingleLine = true
            setText(NoteTaskActions.readDraft(this@NoteTaskInputActivity))
            setSelection(text.length)
        }
        input.doAfterTextChanged { text ->
            // Refreshing the home-screen widget on every key redraws the launcher layer and
            // can steal focus / clip the field; sync draft locally and update the card on exit.
            NoteTaskActions.saveDraft(this, text?.toString().orEmpty(), refreshWidget = false)
        }
        findViewById<TextView>(R.id.note_task_dialog_add).setOnClickListener {
            submit()
        }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                submit()
                true
            } else {
                false
            }
        }
        input.post {
            input.requestFocus()
            getSystemService(InputMethodManager::class.java)
                ?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun submit() {
        val outcome = NoteTaskActions.addTask(this, input.text.toString())
        outcome.message?.let { message ->
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
        }
        if (outcome.clearedDraft) {
            skipDraftOnPause = true
            input.setText("")
        }
        finishQuietly()
    }

    private fun finishQuietly() {
        finish()
        @Suppress("DEPRECATION")
        overridePendingTransition(0, 0)
    }

    override fun onPause() {
        if (!skipDraftOnPause) {
            NoteTaskActions.saveDraft(this, input.text.toString(), refreshWidget = true)
        }
        super.onPause()
    }
}
