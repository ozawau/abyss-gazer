import { useEffect, useState, type FormEvent } from "react";
import type { Task } from "../lib/api";

interface TaskDetailDialogProps {
  open: boolean;
  task: Task | null;
  onClose: () => void;
  onSave: (input: {
    notes: string;
    due_at: number | null;
    start_at: number | null;
  }) => Promise<void>;
}

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Convert unix ms → value for <input type="datetime-local">. */
function toDatetimeLocalValue(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function TaskDetailDialog({
  open,
  task,
  onClose,
  onSave,
}: TaskDetailDialogProps) {
  const [notes, setNotes] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !task) return;
    setNotes(task.notes ?? "");
    setStartLocal(toDatetimeLocalValue(task.start_at));
    setDueLocal(toDatetimeLocalValue(task.due_at));
    setBusy(false);
    setError(null);
  }, [open, task]);

  if (!open || !task) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        notes,
        start_at: fromDatetimeLocalValue(startLocal),
        due_at: fromDatetimeLocalValue(dueLocal),
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const estimate = task.estimate_pomodoros ?? 0;
  const completed = task.completed_pomodoros ?? 0;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card task-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="task-detail-title">任务详情</h2>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <span>任务名称</span>
            <p className="task-detail-title-text">{task.title}</p>
          </div>

          <div className="field">
            <span>预期时钟</span>
            <p className="task-detail-meta">
              预期 {estimate} 个
              {completed > 0 ? ` · 已完成 ${completed} 个` : ""}
            </p>
          </div>

          <div className="field">
            <span>创建时间</span>
            <p className="task-detail-meta">{formatDateTime(task.created_at)}</p>
          </div>

          <label className="field">
            <span>开始时间</span>
            <div className="task-detail-due-row">
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                disabled={busy}
              />
              {startLocal && (
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setStartLocal("")}
                >
                  清除
                </button>
              )}
            </div>
          </label>

          <label className="field">
            <span>到期时间</span>
            <div className="task-detail-due-row">
              <input
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
                disabled={busy}
              />
              {dueLocal && (
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setDueLocal("")}
                >
                  清除
                </button>
              )}
            </div>
          </label>

          <label className="field">
            <span>详细描述</span>
            <textarea
              className="task-detail-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="添加任务说明、步骤或备注…"
              rows={6}
              disabled={busy}
            />
          </label>

          {error && <p className="error-banner">{error}</p>}

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={onClose}
              disabled={busy}
            >
              取消
            </button>
            <button type="submit" className="primary-btn" disabled={busy}>
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
