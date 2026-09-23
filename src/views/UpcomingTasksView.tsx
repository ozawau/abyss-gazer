import { useEffect, useMemo, useState } from "react";
import { CreateSubtaskDialog } from "../components/CreateSubtaskDialog";
import { TaskDetailDialog, type TaskDetailSave } from "../components/TaskDetailDialog";
import { TaskRowMenu } from "../components/TaskRowMenu";
import {
  Category,
  createTask,
  deleteTask,
  listCategories,
  Task,
  updateTask,
} from "../lib/api";
import { isTaskUpcoming } from "../lib/taskSchedule";
import { applyAncestorFields, removeTaskTree } from "../lib/taskTree";

const PAGE_SIZE = 15;

interface UpcomingTasksViewProps {
  tasks: Task[];
  onTasksChange: (tasks: Task[]) => void;
  categoryFilter: string;
  onCategoryFilterChange: (filter: string) => void;
}

function startOfDayMs(ymd: string): number | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00`);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function endOfDayMs(ymd: string): number | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T23:59:59.999`);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function formatDateTime(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UpcomingTasksView({
  tasks,
  onTasksChange,
  categoryFilter,
  onCategoryFilterChange,
}: UpcomingTasksViewProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [titleQuery, setTitleQuery] = useState("");
  const [startFrom, setStartFrom] = useState("");
  const [startTo, setStartTo] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    task: Task;
    x: number;
    y: number;
  } | null>(null);
  const [subtaskParent, setSubtaskParent] = useState<Task | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listCategories()
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = titleQuery.trim().toLowerCase();
    const startStart = startOfDayMs(startFrom);
    const startEnd = endOfDayMs(startTo);
    const createdStart = startOfDayMs(createdFrom);
    const createdEnd = endOfDayMs(createdTo);

    return tasks
      .filter((t) => isTaskUpcoming(t, nowMs))
      .filter((t) => {
        if (q && !t.title.toLowerCase().includes(q)) return false;
        if (categoryFilter === "none" && t.category_id) return false;
        if (
          categoryFilter !== "all" &&
          categoryFilter !== "none" &&
          t.category_id !== categoryFilter
        ) {
          return false;
        }
        const startAt = t.start_at ?? 0;
        if (startStart != null && startAt < startStart) return false;
        if (startEnd != null && startAt > startEnd) return false;
        if (createdStart != null && t.created_at < createdStart) return false;
        if (createdEnd != null && t.created_at > createdEnd) return false;
        return true;
      })
      .sort((a, b) => (a.start_at ?? 0) - (b.start_at ?? 0));
  }, [
    tasks,
    titleQuery,
    categoryFilter,
    startFrom,
    startTo,
    createdFrom,
    createdTo,
    nowMs,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    titleQuery,
    categoryFilter,
    startFrom,
    startTo,
    createdFrom,
    createdTo,
    nowMs,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  async function startNow(task: Task) {
    setBusy(true);
    setError(null);
    try {
      const next = await updateTask({ id: task.id, start_at: null });
      onTasksChange(tasks.map((t) => (t.id === next.id ? next : t)));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    const task = pendingDelete;
    if (!task || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onTasksChange(removeTaskTree(tasks, task.id));
      setPendingDelete(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveTaskDetail(input: TaskDetailSave) {
    if (!detailTask) return;
    const next = await updateTask({
      id: detailTask.id,
      title: input.title,
      ...(detailTask.parent_id ? {} : { category_id: input.category_id }),
      estimate_pomodoros: input.estimate_pomodoros,
      notes: input.notes,
      due_at: input.due_at,
      start_at: input.start_at,
    });
    onTasksChange(applyAncestorFields(tasks, next));
    setDetailTask(next);
  }

  function clearFilters() {
    setTitleQuery("");
    onCategoryFilterChange("all");
    setStartFrom("");
    setStartTo("");
    setCreatedFrom("");
    setCreatedTo("");
  }

  return (
    <div className="view completed-tasks-view">
      <header className="view-header">
        <h1>未开始任务</h1>
        <p>按开始时间由近到远排列，到达开始时间后会出现在当前任务中。</p>
      </header>

      <div className="completed-filters">
        <label className="completed-filter-field">
          <span>任务名称</span>
          <input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            placeholder="搜索标题…"
          />
        </label>
        <label className="completed-filter-field">
          <span>分类</span>
          <select
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="none">未分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="completed-filter-field">
          <span>开始日期</span>
          <div className="completed-date-range">
            <input
              type="date"
              value={startFrom}
              onChange={(e) => setStartFrom(e.target.value)}
              aria-label="开始日期起"
            />
            <span className="completed-date-sep">至</span>
            <input
              type="date"
              value={startTo}
              onChange={(e) => setStartTo(e.target.value)}
              aria-label="开始日期止"
            />
          </div>
        </div>
        <div className="completed-filter-field">
          <span>创建日期</span>
          <div className="completed-date-range">
            <input
              type="date"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
              aria-label="创建日期起"
            />
            <span className="completed-date-sep">至</span>
            <input
              type="date"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
              aria-label="创建日期止"
            />
          </div>
        </div>
        <div className="completed-filter-field completed-filter-actions">
          <span aria-hidden>&nbsp;</span>
          <button
            type="button"
            className="secondary-btn completed-filter-clear"
            onClick={clearFilters}
          >
            清除筛选
          </button>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className="completed-list-meta">
        共 {filtered.length} 条
        {filtered.length > 0 && (
          <>
            ，第 {safePage}/{totalPages} 页
          </>
        )}
      </div>

      {pageItems.length === 0 ? (
        <p className="completed-empty">没有符合条件的未开始任务。</p>
      ) : (
        <ul className="completed-list">
          {pageItems.map((task) => {
            const category = task.category_id
              ? categoryMap.get(task.category_id)
              : null;
            return (
              <li
                key={task.id}
                className="completed-row"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setRowMenu({ task, x: e.clientX, y: e.clientY });
                }}
              >
                <div className="completed-row-main">
                  <strong className="completed-title">{task.title}</strong>
                  <div className="completed-row-meta">
                    {category ? (
                      <span className="task-category-tag">
                        <span
                          className="category-swatch"
                          style={{ background: category.color }}
                          aria-hidden
                        />
                        {category.name}
                      </span>
                    ) : (
                      <span className="completed-meta-muted">未分类</span>
                    )}
                    <span>开始 {formatDateTime(task.start_at)}</span>
                    <span>创建 {formatDateTime(task.created_at)}</span>
                  </div>
                </div>
                <div className="completed-row-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => setDetailTask(task)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => void startNow(task)}
                  >
                    立即开始
                  </button>
                  <button
                    type="button"
                    className="ghost-btn danger"
                    disabled={busy}
                    onClick={() => setPendingDelete(task)}
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="completed-pagination">
          <button
            type="button"
            className="secondary-btn"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="completed-page-indicator">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            className="secondary-btn"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
        </div>
      )}

      {pendingDelete && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !busy && setPendingDelete(null)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>删除任务</h2>
            <div className="delete-confirm">
              <p>确定删除任务「{pendingDelete.title}」？此操作不可撤销。</p>
              <div className="delete-confirm-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={busy}
                  onClick={() => setPendingDelete(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busy}
                  onClick={() => void confirmDelete()}
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <TaskDetailDialog
        open={!!detailTask}
        task={detailTask}
        categories={categories}
        onClose={() => setDetailTask(null)}
        onSave={saveTaskDetail}
        onCreateSubtask={async (title) => {
          if (!detailTask) return;
          const created = await createTask({
            title,
            parent_id: detailTask.id,
          });
          onTasksChange([created, ...tasks]);
        }}
      />

      <CreateSubtaskDialog
        open={!!subtaskParent}
        onClose={() => setSubtaskParent(null)}
        onCreate={async (title) => {
          if (!subtaskParent) return;
          const created = await createTask({
            title,
            parent_id: subtaskParent.id,
          });
          onTasksChange([created, ...tasks]);
        }}
      />

      {rowMenu && (
        <TaskRowMenu
          x={rowMenu.x}
          y={rowMenu.y}
          onClose={() => setRowMenu(null)}
          onEdit={() => {
            setDetailTask(rowMenu.task);
            setRowMenu(null);
          }}
          onCreateSubtask={() => {
            setSubtaskParent(rowMenu.task);
            setRowMenu(null);
          }}
          onDelete={() => {
            setPendingDelete(rowMenu.task);
            setRowMenu(null);
          }}
        />
      )}
    </div>
  );
}
