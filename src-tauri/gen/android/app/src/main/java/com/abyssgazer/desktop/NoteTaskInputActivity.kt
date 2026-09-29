package com.abyssgazer.desktop

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.core.widget.doAfterTextChanged

/** Bottom overlay for widget draft input (fallback when launcher has no widget RemoteInput). */
class NoteTaskInputActivity : Activity() {
    private lateinit var input: EditText
    private var skipDraftOnPause = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.note_task_overlay)
        findViewById<View>(R.id.note_task_overlay_root).setOnClickListener { finishQuietly() }
        findViewById<View>(R.id.note_task_overlay_bar).setOnClickListener { /* keep keyboard */ }
        input = findViewById(R.id.note_task_dialog_input)
        input.setText(NoteTaskActions.readDraft(this))
        input.setSelection(input.text.length)
        input.doAfterTextChanged { text ->
            NoteTaskActions.saveDraft(this, text?.toString().orEmpty())
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
            NoteTaskActions.saveDraft(this, input.text.toString())
        }
        super.onPause()
    }
}
