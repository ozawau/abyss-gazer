package com.abyssgazer.desktop

import android.os.Bundle
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.doAfterTextChanged

/** Dialog to edit the widget draft (launchers cannot host a live IME on RemoteViews). */
class NoteTaskInputActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private var skipDraftOnPause = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.note_task_input_dialog)
        input = findViewById(R.id.note_task_dialog_input)
        input.setText(NoteTaskActions.readDraft(this))
        input.setSelection(input.text.length)
        input.doAfterTextChanged { text ->
            NoteTaskActions.saveDraft(this, text?.toString().orEmpty())
        }
        findViewById<TextView>(R.id.note_task_dialog_cancel).setOnClickListener {
            finish()
        }
        findViewById<TextView>(R.id.note_task_dialog_add).setOnClickListener {
            submit()
        }
        input.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                submit()
                true
            } else {
                false
            }
        }
        input.post {
            input.requestFocus()
            val imm = getSystemService(InputMethodManager::class.java)
            imm?.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun submit() {
        val outcome = NoteTaskActions.addTask(this, input.text.toString())
        outcome.message?.let { message ->
            android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
        }
        if (outcome.clearedDraft) {
            skipDraftOnPause = true
            input.setText("")
        }
        MainActivity.notifyCheckinChanged()
        finish()
    }

    override fun onPause() {
        if (!skipDraftOnPause) {
            NoteTaskActions.saveDraft(this, input.text.toString())
        }
        super.onPause()
    }
}
