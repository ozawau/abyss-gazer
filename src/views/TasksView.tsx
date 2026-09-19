import { useMemo, useState, type FormEvent } from "react";
import {
  createTask,
  deleteTask,
  Task,
  updateTask,
} from "../lib/api";

interface TasksViewProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onTasksChange: (tasks: Task[]) => void;
}

export function TasksView({
  tasks,
  selectedTaskId,
  onSelectTask,
  onTasksChange,
}: TasksViewProps) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { todo, done } = useMemo(() => {
    const todo = tasks.filter((t) => t.status === "todo");
    const done = tasks.filter((t) => t.status === "done");
    return { todo, done };
  }, [tasks]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await createTask(title);
      onTasksChange([task, ...tasks]);
      onSelectTask(task.id);
      setDraft("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(task: Task) {
    setBusy(true);
    setError(null);
    try {
      const next = await updateTask({
        id: task.id,
        status: task.status === "todo" ? "done" : "todo",
      });
      onTasksChange(tasks.map((t) => (t.id === next.id ? next : t)));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    const title = editTitle.trim();
    if (!title) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateTask({ id, title });
      onTasksChange(tasks.map((t) => (t.id === next.id ? next : t)));
      setEditingId(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(task: Task) {
    if (!window.confirm(`删除任务「${task.title}」？`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onTasksChange(tasks.filter((t) => t.id !== task.id));
      if (selectedTaskId === task.id) onSelectTask(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function renderGroup(title: string, items: Task[]) {
    if (items.length === 0) return null;
    return (
      <section className="task-group">
        <h2 className="task-group-title">
          {title}
          <span className="task-count">{items.length}</span>
        </h2>
        <ul className="task-list">
          {items.map((task) => {
            const selected = task.id === selectedTaskId;
            const editing = editingId === task.id;
            return (
              <li
                key={task.id}
                className={`task-row${selected ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className={`task-check${task.status === "done" ? " is-done" : ""}`}
                  aria-label={
                    task.status === "done" ? "标记为未完成" : "标记为完成"
                  }
                  onClick={() => toggleStatus(task)}
                  disabled={busy}
                />
                {editing ? (
                  <input
                    className="task-edit-input"
                    value={editTitle}
                    autoFocus
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(task.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={() => saveEdit(task.id)}
                  />
                ) : (
                  <button
                    type="button"
                    className="task-title-btn"
                    onClick={() => onSelectTask(task.id)}
                    onDoubleClick={() => {
                      setEditingId(task.id);
                      setEditTitle(task.title);
                    }}
                  >
                    {task.title}
                  </button>
                )}
                <div className="task-actions">
                  {!editing && (
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => {
                        setEditingId(task.id);
                        setEditTitle(task.title);
                      }}
                    >
                      编辑
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-btn danger"
                    onClick={() => remove(task)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <div className="view tasks-view">
      <header className="view-header">
        <h1>任务</h1>
        <p>单击选中以绑定番茄钟，双击编辑标题。</p>
      </header>

      <form className="task-create" onSubmit={handleCreate}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="添加新任务…"
          aria-label="新任务标题"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          添加
        </button>
      </form>

      {error && <p className="error-banner">{error}</p>}

      {tasks.length === 0 ? (
        <p className="empty-state">还没有任务，先添加一个吧。</p>
      ) : (
        <>
          {renderGroup("进行中", todo)}
          {renderGroup("已完成", done)}
        </>
      )}
    </div>
  );
}
