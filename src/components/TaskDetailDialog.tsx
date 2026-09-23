import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Category, Task } from "../lib/api";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
import { CategoryPicker } from "./CategoryPicker";
import { ClockEstimatePicker } from "./ClockEstimate";

export interface TaskDetailSave {
  title: string;
  category_id: string | null;
  estimate_pomodoros: number;
  notes: string;
  due_at: number | null;
  start_at: number | null;
}

interface TaskDetailDialogProps {
  open: boolean;
  task: Task | null;
  categories: Category[];
  onClose: () => void;
  onSave: (input: TaskDetailSave) => Promise<void>;
  onCreateSubtask?: (title: string) => Promise<void>;
  onRequestCreateCategory?: () => void;
  onRequestEditCategory?: (category: Category) => void;
  /** Set after a category is created from this dialog. */
  pickedCategory?: { id: string; token: number } | null;
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
  categories,
  onClose,
  onSave,
  onCreateSubtask,
  onRequestCreateCategory,
  onRequestEditCategory,
  pickedCategory,
}: TaskDetailDialogProps) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState(0);
  const [notes, setNotes] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskBusy, setSubtaskBusy] = useState(false);
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  const seenCategoryToken = useRef(0);

  useEffect(() => {
    if (!open || !task) return;
    setTitle(task.title);
    setCategoryId(task.category_id);
    setEstimate(task.estimate_pomodoros ?? 0);
    setNotes(task.notes ?? "");
    setStartLocal(toDatetimeLocalValue(task.start_at));
    setDueLocal(toDatetimeLocalValue(task.due_at));
    setBusy(false);
    setError(null);
    setSubtaskOpen(false);
    setSubtaskTitle("");
    setSubtaskBusy(false);
    setSubtaskError(null);
  }, [open, task]);

  useEffect(() => {
    if (!open) return;
    seenCategoryToken.current = pickedCategory?.token ?? 0;
  }, [open, task?.id]);

  useEffect(() => {
    if (!open || !pickedCategory) return;
    if (pickedCategory.token === seenCategoryToken.current) return;
    seenCategoryToken.current = pickedCategory.token;
    setCategoryId(pickedCategory.id);
  }, [open, pickedCategory]);

  if (!open || !task) return null;

  const isSubtask = !!task.parent_id;
  const category = categoryId
    ? categories.find((item) => item.id === categoryId)
    : null;
  const completed = task.completed_pomodoros ?? 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: nextTitle,
        category_id: isSubtask ? task!.category_id : categoryId,
        estimate_pomodoros: estimate,
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

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card task-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="task-detail-title">编辑任务</h2>
        <form className="task-detail-form" onSubmit={handleSubmit}>
          <div className="task-detail-scroll">
          <label className="field">
            <span>任务名称</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>

          <div className="field">
            <span>分类</span>
            {isSubtask ? (
              <p className="task-detail-meta">
                {category ? category.name : "未分类"}
                <span className="task-detail-hint">与父任务相同，不能单独修改</span>
              </p>
            ) : (
              <CategoryPicker
                categories={categories}
                value={categoryId}
                disabled={busy}
                onChange={setCategoryId}
                onRequestCreate={onRequestCreateCategory}
                onRequestEdit={onRequestEditCategory}
              />
            )}
          </div>

          <div className="field">
            <span>预期时钟</span>
            <ClockEstimatePicker
              value={estimate}
              onChange={setEstimate}
              disabled={busy}
            />
            {completed > 0 && (
              <p className="task-detail-meta">已完成 {formatPomodoroAmount(completed)} 个</p>
            )}
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
          </div>

          {error && <p className="error-banner">{error}</p>}

          <div className="modal-actions">
            {onCreateSubtask && (
              <button
                type="button"
                className="secondary-btn modal-action-start"
                onClick={() => {
                  setSubtaskTitle("");
                  setSubtaskError(null);
                  setSubtaskOpen(true);
                }}
                disabled={busy || subtaskBusy}
              >
                创建子任务
              </button>
            )}
            <button
              type="button"
              className="secondary-btn"
              onClick={onClose}
              disabled={busy || subtaskBusy}
            >
              取消
            </button>
            <button
              type="submit"
              className="primary-btn"
              disabled={busy || subtaskBusy || !title.trim()}
            >
              保存
            </button>
          </div>
        </form>
      </div>

      {subtaskOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
            if (!subtaskBusy) setSubtaskOpen(false);
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-subtask-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-subtask-title">创建子任务</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const title = subtaskTitle.trim();
                if (!title || !onCreateSubtask || subtaskBusy) return;
                setSubtaskBusy(true);
                setSubtaskError(null);
                void onCreateSubtask(title)
                  .then(() => {
                    setSubtaskOpen(false);
                    setSubtaskTitle("");
                  })
                  .catch((err) => setSubtaskError(String(err)))
                  .finally(() => setSubtaskBusy(false));
              }}
            >
              <label className="field">
                <span>任务名称</span>
                <input
                  value={subtaskTitle}
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  placeholder="输入子任务名称…"
                  autoFocus
                  disabled={subtaskBusy}
                />
              </label>
              {subtaskError && <p className="error-banner">{subtaskError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={subtaskBusy}
                  onClick={() => setSubtaskOpen(false)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={subtaskBusy || !subtaskTitle.trim()}
                >
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
