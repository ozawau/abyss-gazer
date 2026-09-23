import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Task } from "../lib/api";
import { dayKey } from "../lib/calendar";
import { flattenTaskTree } from "../lib/taskTree";

interface HabitCheckinDialogProps {
  habit: Task | null;
  day: Date | null;
  tasks: Task[];
  initialChecked: boolean;
  initialNote: string;
  initialSelected: string[];
  recordedIds: string[];
  checkedByClock: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: { checked: boolean; note: string; selectedIds: string[] }) => void;
}

export function HabitCheckinDialog({
  habit,
  day,
  tasks,
  initialChecked,
  initialNote,
  initialSelected,
  recordedIds,
  checkedByClock,
  busy,
  onCancel,
  onSave,
}: HabitCheckinDialogProps) {
  const [checked, setChecked] = useState(initialChecked);
  const [note, setNote] = useState(initialNote);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));

  const dayToken = day ? dayKey(day) : "";
  const selectedToken = initialSelected.join("\n");

  useEffect(() => {
    if (!habit || !day) return;
    setChecked(initialChecked);
    setNote(initialNote);
    setSelected(new Set(initialSelected));
  }, [habit?.id, dayToken, initialChecked, initialNote, selectedToken]);

  useEffect(() => {
    if (!habit) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [habit, busy, onCancel]);

  const recordedToken = recordedIds.join("\n");
  const recorded = useMemo(() => new Set(recordedIds), [recordedToken]);

  const tree = useMemo(() => {
    if (!habit) return [];
    return flattenTaskTree(tasks, new Set(), [habit]).filter((node) => {
      if (node.task.id === habit.id) return true;
      if (node.task.status !== "done") return true;
      return recorded.has(node.task.id);
    });
  }, [habit, tasks, recorded]);
  const hasChildren = tree.some((node) => node.task.id !== habit?.id);

  if (!habit || !day) return null;

  const dateLabel = `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    onSave({
      checked,
      note: note.trim(),
      selectedIds: checked ? [...selected] : [],
    });
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        className="modal-card task-detail-card habit-checkin-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-checkin-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="habit-checkin-title">打卡详情</h2>
        <form className="task-detail-form" onSubmit={handleSubmit}>
          <div className="task-detail-scroll">
            <p className="task-detail-title-text">{habit.title}</p>
            <p className="task-detail-meta habit-checkin-date">{dateLabel}</p>

            <fieldset className="habit-checkin-status">
              <legend>当天状态</legend>
              <label>
                <input
                  type="radio"
                  name="habit-checkin-status"
                  checked={checked}
                  disabled={busy}
                  onChange={() => setChecked(true)}
                />
                已打卡
              </label>
              <label>
                <input
                  type="radio"
                  name="habit-checkin-status"
                  checked={!checked}
                  disabled={busy}
                  onChange={() => setChecked(false)}
                />
                未打卡
              </label>
            </fieldset>

            {checkedByClock && (
              <p className="habit-checkin-clock">
                当天已有完成的番茄钟，保存为未打卡后仍会显示已打卡。
              </p>
            )}

            {hasChildren && (
              <div className="field">
                <span>任务</span>
                <ul className="habit-checkin-tree">
                  {tree.map((node) => {
                    const done = node.task.id !== habit.id && node.task.status === "done";
                    return (
                    <li key={node.task.id}>
                      <label
                        className={`habit-checkin-node${done ? " is-done" : ""}`}
                        style={{ paddingLeft: `${node.depth * 1.1}rem` }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(node.task.id)}
                          disabled={busy || !checked}
                          onChange={() => toggleSelected(node.task.id)}
                        />
                        <span>{node.task.title}</span>
                      </label>
                    </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <label className="field">
              <span>当天描述</span>
              <textarea
                className="task-detail-notes"
                value={note}
                rows={4}
                disabled={busy || !checked}
                placeholder="记录这一天的情况…"
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              disabled={busy}
              onClick={onCancel}
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
