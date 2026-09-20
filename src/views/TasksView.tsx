import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CategoryDialog } from "../components/CategoryDialog";
import { CategoryPicker } from "../components/CategoryPicker";
import {
  ClockEstimatePicker,
  TaskPomodoroClocks,
} from "../components/ClockEstimate";
import { TaskDetailDialog } from "../components/TaskDetailDialog";
import {
  Category,
  createCategory,
  createTask,
  deleteCategory,
  deleteTask,
  listCategories,
  listFocusCountsSince,
  reorderTask,
  startOfLocalDayMs,
  Task,
  TaskPriority,
  updateCategory,
  updateTask,
} from "../lib/api";
import {
  formatGregorianDate,
  formatLunarDate,
  formatWeekday,
  splitDurationMinutes,
} from "../lib/dateDisplay";

const POMODORO_MINUTES = 25;

function StatDuration({ totalMinutes }: { totalMinutes: number }) {
  const { hours, minutes } = splitDurationMinutes(totalMinutes);
  return (
    <strong className="stat-duration">
      {hours > 0 && (
        <>
          <span className="stat-num">{hours}</span>
          <span className="stat-unit">小时</span>
        </>
      )}
      {(hours === 0 || minutes > 0) && (
        <>
          <span className="stat-num">{minutes}</span>
          <span className="stat-unit">分</span>
        </>
      )}
    </strong>
  );
}

export type CategoryFilter = "all" | "none" | string;

interface TasksViewProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onTasksChange: (tasks: Task[]) => void;
  onStartPomodoro: (taskId: string) => void;
  categoryFilter: CategoryFilter;
  onCategoryFilterChange: (filter: CategoryFilter) => void;
}

const PRIORITY_GROUPS: { id: TaskPriority; label: string }[] = [
  { id: "high", label: "高优先级" },
  { id: "medium", label: "中优先级" },
  { id: "low", label: "低优先级" },
];

interface DragState {
  taskId: string;
  title: string;
  x: number;
  y: number;
  width: number;
}

interface DropTarget {
  priority: TaskPriority;
  beforeId: string | null;
}

function normalizePriority(value: string | undefined): TaskPriority | null {
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

function dropTargetFromPoint(
  x: number,
  y: number,
  draggingId: string,
): DropTarget | null {
  const el = document.elementFromPoint(x, y);
  const group = el?.closest("[data-priority]") as HTMLElement | null;
  const priority = normalizePriority(group?.dataset.priority);
  if (!priority || !group) return null;

  const row = el?.closest("[data-task-id]") as HTMLElement | null;
  if (!row || !group.contains(row)) {
    return { priority, beforeId: null };
  }

  const rowId = row.dataset.taskId;
  if (!rowId || rowId === draggingId) {
    return { priority, beforeId: null };
  }

  const rect = row.getBoundingClientRect();
  const insertBefore = y < rect.top + rect.height / 2;
  if (insertBefore) {
    return { priority, beforeId: rowId };
  }

  let next = row.nextElementSibling as HTMLElement | null;
  while (next && next.dataset.taskId === draggingId) {
    next = next.nextElementSibling as HTMLElement | null;
  }
  return {
    priority,
    beforeId: next?.dataset.taskId ?? null,
  };
}

export function TasksView({
  tasks,
  selectedTaskId,
  onSelectTask,
  onTasksChange,
  onStartPomodoro,
  categoryFilter,
  onCategoryFilterChange,
}: TasksViewProps) {
  const [draft, setDraft] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState<string | null>(null);
  const [draftEstimate, setDraftEstimate] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editEstimate, setEditEstimate] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [createFor, setCreateFor] = useState<"draft" | "edit" | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [todayFocusByTask, setTodayFocusByTask] = useState<Map<string, number>>(
    () => new Map(),
  );

  const dragRef = useRef<DragState | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

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

  useEffect(() => {
    let cancelled = false;
    listFocusCountsSince(startOfLocalDayMs())
      .then((rows) => {
        if (cancelled) return;
        const map = new Map<string, number>();
        for (const row of rows) map.set(row.task_id, row.count);
        setTodayFocusByTask(map);
      })
      .catch(() => {
        if (!cancelled) setTodayFocusByTask(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [tasks]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const filteredTasks = useMemo(() => {
    if (categoryFilter === "all") return tasks;
    if (categoryFilter === "none") {
      return tasks.filter((t) => !t.category_id);
    }
    return tasks.filter((t) => t.category_id === categoryFilter);
  }, [tasks, categoryFilter]);

  const dayHeader = useMemo(() => {
    const now = new Date();
    return {
      date: formatGregorianDate(now),
      weekday: formatWeekday(now),
      lunar: formatLunarDate(now),
    };
  }, []);

  const categoryStats = useMemo(() => {
    let todayFocusSessions = 0;
    let todayFocusedTasks = 0;
    let doneCount = 0;
    let todoCount = 0;
    let remainingPomodoros = 0;

    for (const task of filteredTasks) {
      const todayCount = todayFocusByTask.get(task.id) ?? 0;
      if (todayCount > 0) {
        todayFocusedTasks += 1;
        todayFocusSessions += todayCount;
      }
      if (task.status === "done") {
        doneCount += 1;
      } else {
        todoCount += 1;
        const estimate = task.estimate_pomodoros ?? 0;
        const completed = task.completed_pomodoros ?? 0;
        remainingPomodoros += Math.max(0, estimate - completed);
      }
    }

    return {
      todayFocusMinutes: todayFocusSessions * POMODORO_MINUTES,
      todayFocusedTasks,
      doneCount,
      remainingMinutes: remainingPomodoros * POMODORO_MINUTES,
      todoCount,
    };
  }, [filteredTasks, todayFocusByTask]);

  const grouped = useMemo(() => {
    const map: Record<TaskPriority, Task[]> = {
      high: [],
      medium: [],
      low: [],
    };
    for (const task of filteredTasks) {
      if (task.status === "done") continue;
      const key = normalizePriority(task.priority) ?? "medium";
      map[key].push(task);
    }
    return map;
  }, [filteredTasks]);

  const draggingTask = drag
    ? tasks.find((t) => t.id === drag.taskId) ?? null
    : null;

  useEffect(() => {
    if (!drag) {
      document.body.classList.remove("is-task-dragging");
      return;
    }
    document.body.classList.add("is-task-dragging");
    window.getSelection()?.removeAllRanges();

    function onMove(e: PointerEvent) {
      e.preventDefault();
      const next = dragRef.current;
      if (!next) return;
      const updated = { ...next, x: e.clientX, y: e.clientY };
      dragRef.current = updated;
      setDrag(updated);
      setDropTarget(dropTargetFromPoint(e.clientX, e.clientY, next.taskId));
    }

    function onUp(e: PointerEvent) {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      const target = current
        ? dropTargetFromPoint(e.clientX, e.clientY, current.taskId)
        : null;
      setDropTarget(null);
      document.body.classList.remove("is-task-dragging");
      if (!current || !target) return;

      const existing = tasksRef.current.find((t) => t.id === current.taskId);
      if (!existing) return;

      const sameGroup = tasksRef.current
        .filter((t) => t.priority === target.priority)
        .map((t) => t.id);
      const without = sameGroup.filter((id) => id !== current.taskId);
      const insertAt =
        target.beforeId == null
          ? without.length
          : without.indexOf(target.beforeId);
      if (insertAt < 0) return;

      const nextOrder = [...without];
      nextOrder.splice(insertAt, 0, current.taskId);
      const unchanged =
        existing.priority === target.priority &&
        nextOrder.length === sameGroup.length &&
        nextOrder.every((id, i) => id === sameGroup[i]);
      if (unchanged) return;

      setBusy(true);
      setError(null);
      void reorderTask({
        id: current.taskId,
        priority: target.priority,
        before_id: target.beforeId,
      })
        .then((rows) => onTasksChange(rows))
        .catch((err) => setError(String(err)))
        .finally(() => setBusy(false));
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("is-task-dragging");
    };
  }, [drag?.taskId, onTasksChange]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = await createTask({
        title,
        category_id: draftCategoryId,
        estimate_pomodoros: draftEstimate,
      });
      onTasksChange([task, ...tasks]);
      onSelectTask(task.id);
      setDraft("");
      setDraftEstimate(0);
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
      const next = await updateTask({
        id,
        title,
        category_id: editCategoryId,
        estimate_pomodoros: editEstimate,
      });
      onTasksChange(tasks.map((t) => (t.id === next.id ? next : t)));
      setEditingId(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove() {
    const task = pendingDeleteTask;
    if (!task || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(task.id);
      onTasksChange(tasks.filter((t) => t.id !== task.id));
      if (selectedTaskId === task.id) onSelectTask(null);
      setPendingDeleteTask(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveTaskDetail(input: {
    notes: string;
    due_at: number | null;
  }) {
    if (!detailTask) return;
    const next = await updateTask({
      id: detailTask.id,
      notes: input.notes,
      due_at: input.due_at,
    });
    onTasksChange(tasks.map((t) => (t.id === next.id ? next : t)));
    setDetailTask(next);
  }

  async function handleSaveCategory(name: string, color: string) {
    if (editingCategory) {
      const updated = await updateCategory({
        id: editingCategory.id,
        name,
        color,
      });
      setCategories((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c)),
      );
      return;
    }
    const category = await createCategory(name, color);
    setCategories((prev) => [...prev, category]);
    if (createFor === "draft") setDraftCategoryId(category.id);
    if (createFor === "edit") setEditCategoryId(category.id);
  }

  async function handleDeleteCategory(id: string) {
    await deleteCategory(id);
    setCategories((prev) => prev.filter((c) => c.id !== id));
    onTasksChange(
      tasks.map((t) =>
        t.category_id === id ? { ...t, category_id: null } : t,
      ),
    );
    if (draftCategoryId === id) setDraftCategoryId(null);
    if (editCategoryId === id) setEditCategoryId(null);
    if (categoryFilter === id) onCategoryFilterChange("all");
  }

  function openCreateCategory(target: "draft" | "edit") {
    setEditingCategory(null);
    setCreateFor(target);
    setCategoryDialogOpen(true);
  }

  function openEditCategory(category: Category) {
    setCreateFor(null);
    setEditingCategory(category);
    setCategoryDialogOpen(true);
  }

  function closeCategoryDialog() {
    setCategoryDialogOpen(false);
    setEditingCategory(null);
    setCreateFor(null);
  }

  function beginEdit(task: Task) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditCategoryId(task.category_id);
    setEditEstimate(task.estimate_pomodoros ?? 0);
  }

  function beginDrag(
    task: Task,
    clientX: number,
    clientY: number,
    width: number,
  ) {
    window.getSelection()?.removeAllRanges();
    const next: DragState = {
      taskId: task.id,
      title: task.title,
      x: clientX,
      y: clientY,
      width,
    };
    dragRef.current = next;
    setDrag(next);
    setDropTarget({
      priority: normalizePriority(task.priority) ?? "medium",
      beforeId: null,
    });
  }

  function armRowPointer(
    e: ReactPointerEvent<HTMLLIElement>,
    task: Task,
  ) {
    if (e.button !== 0 || busy || editingId === task.id) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        ".task-check, .task-play, .task-actions, .category-picker, .clock-estimate-picker, input, textarea",
      )
    ) {
      return;
    }

    const row = e.currentTarget;
    const width = row.getBoundingClientRect().width;
    const fromHandle = !!target.closest(".drag-handle");

    if (fromHandle) {
      e.preventDefault();
      beginDrag(task, e.clientX, e.clientY, width);
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    let armed = true;

    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }

    function onMove(ev: PointerEvent) {
      if (!armed) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      armed = false;
      cleanup();
      ev.preventDefault();
      beginDrag(task, ev.clientX, ev.clientY, width);
    }

    function onUp() {
      armed = false;
      cleanup();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onRowClick(
    e: ReactMouseEvent<HTMLLIElement>,
    task: Task,
  ) {
    if (editingId === task.id) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        ".task-check, .task-play, .task-actions, .category-picker, .clock-estimate-picker, input, textarea",
      )
    ) {
      return;
    }
    onSelectTask(task.id);
  }

  function renderGroup(priority: TaskPriority, label: string, items: Task[]) {
    const isGroupTarget = dropTarget?.priority === priority && !!drag;
    const showEndIndicator =
      isGroupTarget && dropTarget?.beforeId == null && items.length > 0;

    return (
      <section
        key={priority}
        data-priority={priority}
        className={`task-group priority-${priority}${isGroupTarget ? " is-drop-target" : ""}`}
      >
        <h2 className="task-group-title">
          <span className={`priority-dot priority-${priority}`} aria-hidden />
          {label}
          <span className="task-count">{items.length}</span>
        </h2>
        <ul className="task-list">
          {items.length === 0 ? (
            <li className="task-drop-hint">拖到此处</li>
          ) : (
            items.map((task) => {
              const selected = task.id === selectedTaskId;
              const editing = editingId === task.id;
              const isDragging = drag?.taskId === task.id;
              const showBefore =
                isGroupTarget &&
                dropTarget?.beforeId === task.id &&
                drag?.taskId !== task.id;
              const category = task.category_id
                ? categoryMap.get(task.category_id)
                : null;
              return (
                <li
                  key={task.id}
                  data-task-id={task.id}
                  className={`task-row${selected ? " is-selected" : ""}${
                    task.status === "done" ? " is-done" : ""
                  }${isDragging ? " is-dragging" : ""}${
                    showBefore ? " drop-before" : ""
                  }`}
                  onPointerDown={(e) => armRowPointer(e, task)}
                  onClick={(e) => onRowClick(e, task)}
                  onDoubleClick={(e) => {
                    if (editing) return;
                    const target = e.target as HTMLElement;
                    if (
                      target.closest(
                        ".task-check, .task-play, .task-actions, .category-picker, .clock-estimate-picker, input, textarea",
                      )
                    ) {
                      return;
                    }
                    beginEdit(task);
                  }}
                >
                  <button
                    type="button"
                    className="drag-handle"
                    title="按住拖动调整优先级或排序"
                    aria-label={`拖动「${task.title}」调整位置`}
                    disabled={busy || editing}
                  >
                    ⋮⋮
                  </button>
                  <button
                    type="button"
                    className={`task-check${task.status === "done" ? " is-done" : ""}`}
                    aria-label={
                      task.status === "done" ? "标记为未完成" : "标记为完成"
                    }
                    onClick={() => toggleStatus(task)}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className="task-play"
                    title="开始番茄钟"
                    aria-label={`用番茄钟专注「${task.title}」`}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartPomodoro(task.id);
                    }}
                  >
                    ▶
                  </button>
                  {editing ? (
                    <div className="task-edit-fields">
                      <input
                        className="task-edit-input"
                        value={editTitle}
                        autoFocus
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveEdit(task.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <CategoryPicker
                        categories={categories}
                        value={editCategoryId}
                        compact
                        disabled={busy}
                        onChange={setEditCategoryId}
                        onRequestCreate={() => openCreateCategory("edit")}
                        onRequestEdit={openEditCategory}
                      />
                      <ClockEstimatePicker
                        value={editEstimate}
                        onChange={setEditEstimate}
                        disabled={busy}
                      />
                    </div>
                  ) : (
                    <div className="task-main">
                      <span className="task-title-btn">{task.title}</span>
                      {category && (
                        <span className="task-category-tag">
                          <span
                            className="category-swatch"
                            style={{ background: category.color }}
                            aria-hidden
                          />
                          {category.name}
                        </span>
                      )}
                      <TaskPomodoroClocks
                        estimate={task.estimate_pomodoros ?? 0}
                        completed={task.completed_pomodoros ?? 0}
                      />
                    </div>
                  )}
                  <div className="task-actions">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => void saveEdit(task.id)}
                          disabled={busy}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => setEditingId(null)}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => beginEdit(task)}
                      >
                        编辑
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailTask(task);
                      }}
                      disabled={busy}
                    >
                      更多
                    </button>
                    <button
                      type="button"
                      className="ghost-btn danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteTask(task);
                      }}
                      disabled={busy}
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })
          )}
          {showEndIndicator && <li className="drop-line drop-line-end" aria-hidden />}
        </ul>
      </section>
    );
  }

  return (
    <div className="view tasks-view">
      <header className="view-header tasks-day-header">
        <div className="tasks-day-title">
          <h1>{dayHeader.date}</h1>
          <p className="tasks-day-meta">
            {dayHeader.weekday}
            {dayHeader.lunar ? ` · ${dayHeader.lunar}` : ""}
          </p>
        </div>
        <ul className="tasks-day-stats" aria-label="今日统计">
          <li>
            <span className="stat-label">今日专注</span>
            <StatDuration totalMinutes={categoryStats.todayFocusMinutes} />
          </li>
          <li>
            <span className="stat-label">专注任务</span>
            <strong>{categoryStats.todayFocusedTasks}</strong>
          </li>
          <li>
            <span className="stat-label">已完成</span>
            <strong>{categoryStats.doneCount}</strong>
          </li>
          <li>
            <span className="stat-label">剩余预估</span>
            <StatDuration totalMinutes={categoryStats.remainingMinutes} />
          </li>
          <li>
            <span className="stat-label">未完成</span>
            <strong>{categoryStats.todoCount}</strong>
          </li>
        </ul>
      </header>

      <form className="task-create" onSubmit={handleCreate}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="添加新任务…"
          aria-label="新任务标题"
          disabled={busy}
        />
        <CategoryPicker
          categories={categories}
          value={draftCategoryId}
          disabled={busy}
          onChange={setDraftCategoryId}
          onRequestCreate={() => openCreateCategory("draft")}
          onRequestEdit={openEditCategory}
        />
        <ClockEstimatePicker
          value={draftEstimate}
          onChange={setDraftEstimate}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          添加
        </button>
      </form>

      <div className="category-filter" role="toolbar" aria-label="按分类筛选">
        <button
          type="button"
          className={`filter-chip${categoryFilter === "all" ? " is-active" : ""}`}
          onClick={() => onCategoryFilterChange("all")}
        >
          全部
        </button>
        <button
          type="button"
          className={`filter-chip${categoryFilter === "none" ? " is-active" : ""}`}
          onClick={() => onCategoryFilterChange("none")}
        >
          未分类
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`filter-chip${categoryFilter === c.id ? " is-active" : ""}`}
            onClick={() => onCategoryFilterChange(c.id)}
            onDoubleClick={() => openEditCategory(c)}
            title="双击编辑分类"
          >
            <span
              className="category-swatch"
              style={{ background: c.color }}
              aria-hidden
            />
            {c.name}
          </button>
        ))}
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className={`priority-boards${drag ? " is-dragging" : ""}`}>
        {PRIORITY_GROUPS.map((g) =>
          renderGroup(g.id, g.label, grouped[g.id]),
        )}
      </div>

      {drag && (
        <div
          className="drag-ghost"
          style={{
            width: drag.width,
            transform: `translate(${drag.x + 12}px, ${drag.y - 18}px)`,
          }}
        >
          <span className="drag-handle" aria-hidden>
            ⋮⋮
          </span>
          <span className="drag-ghost-title">{drag.title}</span>
          {draggingTask && (
            <span className={`priority-dot priority-${draggingTask.priority}`} />
          )}
        </div>
      )}

      <CategoryDialog
        open={categoryDialogOpen}
        initial={editingCategory}
        onClose={closeCategoryDialog}
        onSubmit={handleSaveCategory}
        onDelete={
          editingCategory
            ? () => handleDeleteCategory(editingCategory.id)
            : undefined
        }
      />

      <TaskDetailDialog
        open={!!detailTask}
        task={detailTask}
        onClose={() => setDetailTask(null)}
        onSave={saveTaskDetail}
      />

      {pendingDeleteTask && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !busy && setPendingDeleteTask(null)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-task-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-task-title">删除任务</h2>
            <div className="delete-confirm">
              <p>确定删除任务「{pendingDeleteTask.title}」？此操作不可撤销。</p>
              <div className="delete-confirm-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={busy}
                  onClick={() => setPendingDeleteTask(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busy}
                  onClick={() => void confirmRemove()}
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
