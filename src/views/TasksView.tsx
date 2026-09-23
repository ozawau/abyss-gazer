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
import { CreateSubtaskDialog } from "../components/CreateSubtaskDialog";
import { TaskDetailDialog, type TaskDetailSave } from "../components/TaskDetailDialog";
import { TaskRowMenu } from "../components/TaskRowMenu";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
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
import { isTaskStarted } from "../lib/taskSchedule";
import {
  applyAncestorFields,
  childIdSet,
  flattenTaskTree,
  removeTaskTree,
  taskById,
  withAncestors,
  type TaskNode,
} from "../lib/taskTree";

const EXPAND_STORAGE_KEY = "abyss-gazer.expanded-tasks";

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
  parentId: string | null;
  beforeId: string | null;
}

function normalizePriority(value: string | undefined): TaskPriority | null {
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

function siblingTasks(
  tasks: Task[],
  parentId: string | null,
  priority?: TaskPriority,
): Task[] {
  return tasks
    .filter((task) => {
      if ((task.parent_id ?? null) !== parentId) return false;
      if (parentId == null && priority) return task.priority === priority;
      return true;
    })
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
}

function owningSibling(
  hoveredId: string,
  parentId: string | null,
  byId: Map<string, Task>,
): Task | null {
  let current = byId.get(hoveredId);
  while (current) {
    if ((current.parent_id ?? null) === parentId) return current;
    if (!current.parent_id) return null;
    current = byId.get(current.parent_id);
  }
  return null;
}

function belongsToParent(
  task: Task,
  parentId: string,
  byId: Map<string, Task>,
): boolean {
  let current: Task | undefined = task;
  while (current) {
    if (current.parent_id === parentId) return true;
    if (!current.parent_id) return false;
    current = byId.get(current.parent_id);
  }
  return false;
}

function dropTargetFromPoint(
  x: number,
  y: number,
  dragging: Task,
  tasks: Task[],
): DropTarget | null {
  const byId = taskById(tasks);
  const el = document.elementFromPoint(x, y);
  const group = el?.closest("[data-priority]") as HTMLElement | null;
  const priority = normalizePriority(group?.dataset.priority);
  if (!priority || !group) return null;

  if (dragging.parent_id) {
    const parent = byId.get(dragging.parent_id);
    if (!parent) return null;
    const parentPriority = normalizePriority(parent.priority) ?? "medium";
    if (priority !== parentPriority) return null;

    const siblings = siblingTasks(tasks, dragging.parent_id);
    const firstOther = siblings.find((task) => task.id !== dragging.id);
    const row = el?.closest("[data-task-id]") as HTMLElement | null;
    if (!row || !group.contains(row)) {
      return { priority, parentId: dragging.parent_id, beforeId: null };
    }
    const rowId = row.dataset.taskId;
    if (!rowId || rowId === dragging.id) {
      return { priority, parentId: dragging.parent_id, beforeId: null };
    }
    if (rowId === dragging.parent_id) {
      return {
        priority,
        parentId: dragging.parent_id,
        beforeId: firstOther?.id ?? null,
      };
    }
    const sibling = owningSibling(rowId, dragging.parent_id, byId);
    if (!sibling || sibling.id === dragging.id) {
      return { priority, parentId: dragging.parent_id, beforeId: null };
    }
    const siblingEl =
      (group.querySelector(
        `[data-task-id="${sibling.id}"]`,
      ) as HTMLElement | null) ?? row;
    const insertBefore = y < siblingEl.getBoundingClientRect().top + siblingEl.getBoundingClientRect().height / 2;
    if (insertBefore) {
      return { priority, parentId: dragging.parent_id, beforeId: sibling.id };
    }
    const idx = siblings.findIndex((task) => task.id === sibling.id);
    const next = siblings.slice(idx + 1).find((task) => task.id !== dragging.id);
    return { priority, parentId: dragging.parent_id, beforeId: next?.id ?? null };
  }

  const row = el?.closest("[data-task-id]") as HTMLElement | null;
  if (!row || !group.contains(row)) {
    return { priority, parentId: null, beforeId: null };
  }
  const rowId = row.dataset.taskId;
  if (!rowId || rowId === dragging.id) {
    return { priority, parentId: null, beforeId: null };
  }
  const hovered = byId.get(rowId);
  if (!hovered) return { priority, parentId: null, beforeId: null };
  let root = hovered;
  while (root.parent_id) {
    const parent = byId.get(root.parent_id);
    if (!parent) break;
    root = parent;
  }
  if (root.id === dragging.id) {
    return { priority, parentId: null, beforeId: null };
  }
  const rootEl =
    (group.querySelector(`[data-task-id="${root.id}"]`) as HTMLElement | null) ??
    row;
  const rect = rootEl.getBoundingClientRect();
  const insertBefore = y < rect.top + rect.height / 2;
  if (insertBefore) {
    return { priority, parentId: null, beforeId: root.id };
  }
  const roots = siblingTasks(tasks, null, priority);
  const idx = roots.findIndex((task) => task.id === root.id);
  const next = roots.slice(idx + 1).find((task) => task.id !== dragging.id);
  return { priority, parentId: null, beforeId: next?.id ?? null };
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [createFor, setCreateFor] = useState<"draft" | "detail" | null>(null);
  const [pickedCategory, setPickedCategory] = useState<{
    id: string;
    token: number;
  } | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    task: Task;
    x: number;
    y: number;
  } | null>(null);
  const [subtaskParent, setSubtaskParent] = useState<Task | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [todayFocusByTask, setTodayFocusByTask] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(EXPAND_STORAGE_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const dragRef = useRef<DragState | null>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

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

  useEffect(() => {
    sessionStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify([...expandedIds]));
  }, [expandedIds]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const filteredTasks = useMemo(() => {
    const byCategory =
      categoryFilter === "all"
        ? tasks
        : categoryFilter === "none"
          ? tasks.filter((t) => !t.category_id)
          : tasks.filter((t) => t.category_id === categoryFilter);
    return byCategory.filter(
      (t) => t.status === "done" || isTaskStarted(t, nowMs),
    );
  }, [tasks, categoryFilter, nowMs]);

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
      todayFocusSessions,
      todayFocusMinutes: todayFocusSessions * POMODORO_MINUTES,
      todayFocusedTasks,
      doneCount,
      remainingMinutes: remainingPomodoros * POMODORO_MINUTES,
      todoCount,
    };
  }, [filteredTasks, todayFocusByTask]);

  const boardTasks = useMemo(
    () =>
      withAncestors(
        filteredTasks.filter((task) => task.status !== "done"),
        tasks,
      ),
    [filteredTasks, tasks],
  );

  const collapsedIds = useMemo(() => {
    const ids = childIdSet(boardTasks);
    for (const id of expandedIds) ids.delete(id);
    return ids;
  }, [boardTasks, expandedIds]);

  const grouped = useMemo(() => {
    const map: Record<TaskPriority, TaskNode[]> = {
      high: [],
      medium: [],
      low: [],
    };
    const roots = boardTasks.filter((task) => !task.parent_id);
    for (const group of PRIORITY_GROUPS) {
      const groupRoots = roots.filter(
        (task) => (normalizePriority(task.priority) ?? "medium") === group.id,
      );
      map[group.id] = flattenTaskTree(boardTasks, collapsedIds, groupRoots);
    }
    return map;
  }, [boardTasks, collapsedIds]);

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
      const moving = tasksRef.current.find((t) => t.id === next.taskId);
      setDropTarget(
        moving
          ? dropTargetFromPoint(e.clientX, e.clientY, moving, tasksRef.current)
          : null,
      );
    }

    function onUp(e: PointerEvent) {
      const current = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      const moving = current
        ? tasksRef.current.find((t) => t.id === current.taskId)
        : null;
      const target =
        current && moving
          ? dropTargetFromPoint(e.clientX, e.clientY, moving, tasksRef.current)
          : null;
      setDropTarget(null);
      document.body.classList.remove("is-task-dragging");
      if (!current || !moving || !target) return;
      if ((moving.parent_id ?? null) !== target.parentId) return;

      const sameGroup = siblingTasks(
        tasksRef.current,
        target.parentId,
        target.parentId == null ? target.priority : undefined,
      ).map((task) => task.id);
      const without = sameGroup.filter((id) => id !== current.taskId);
      const insertAt =
        target.beforeId == null
          ? without.length
          : without.indexOf(target.beforeId);
      if (insertAt < 0) return;

      const nextOrder = [...without];
      nextOrder.splice(insertAt, 0, current.taskId);
      const unchanged =
        (moving.parent_id != null || moving.priority === target.priority) &&
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

  async function confirmRemove() {
    const task = pendingDeleteTask;
    if (!task || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTask(task.id);
      const next = removeTaskTree(tasks, task.id);
      onTasksChange(next);
      if (selectedTaskId && !next.some((row) => row.id === selectedTaskId)) {
        onSelectTask(null);
      }
      setPendingDeleteTask(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateSubtask(parent: Task, title: string) {
    const task = await createTask({
      title,
      parent_id: parent.id,
    });
    onTasksChange([task, ...tasks]);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      let current: Task | undefined = parent;
      const byId = taskById(tasks);
      while (current) {
        next.add(current.id);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
      return next;
    });
    onSelectTask(task.id);
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
    if (createFor === "detail") {
      setPickedCategory((prev) => ({
        id: category.id,
        token: (prev?.token ?? 0) + 1,
      }));
    }
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
    if (categoryFilter === id) onCategoryFilterChange("all");
  }

  function openCreateCategory(target: "draft" | "detail") {
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
      parentId: task.parent_id,
      beforeId: null,
    });
  }

  function armRowPointer(
    e: ReactPointerEvent<HTMLLIElement>,
    task: Task,
  ) {
    if (e.button !== 0 || busy) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        ".task-check, .task-play, .task-toggle, .task-actions, .category-picker, .clock-estimate-picker, input, textarea",
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
    const target = e.target as HTMLElement;
    if (
      target.closest(
        ".task-check, .task-play, .task-toggle, .task-actions, .category-picker, .clock-estimate-picker, input, textarea",
      )
    ) {
      return;
    }
    onSelectTask(task.id);
  }

  function toggleCollapsed(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAllSubtasks() {
    setExpandedIds(new Set(childIdSet(tasks)));
  }

  function collapseAllSubtasks() {
    setExpandedIds(new Set());
  }

  function renderGroup(priority: TaskPriority, label: string, items: TaskNode[]) {
    const draggingChild = !!draggingTask?.parent_id;
    const isGroupTarget =
      !!drag &&
      dropTarget?.priority === priority &&
      (draggingChild ? dropTarget.parentId != null : dropTarget.parentId == null);
    const byId = taskById(tasks);
    const lastChildDropId =
      draggingTask?.parent_id &&
      dropTarget?.parentId === draggingTask.parent_id &&
      dropTarget.beforeId == null
        ? [...items]
            .reverse()
            .find((node) =>
              belongsToParent(node.task, draggingTask.parent_id!, byId),
            )?.task.id ?? null
        : null;
    const showEndIndicator =
      isGroupTarget &&
      !draggingChild &&
      dropTarget?.beforeId == null &&
      items.length > 0;

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
            items.map(({ task, depth, hasChildren }) => {
              const selected = task.id === selectedTaskId;
              const isDragging = drag?.taskId === task.id;
              const showBefore =
                isGroupTarget &&
                dropTarget?.beforeId === task.id &&
                drag?.taskId !== task.id;
              const showAfter = lastChildDropId === task.id && !showBefore;
              const category = task.category_id
                ? categoryMap.get(task.category_id)
                : null;
              const isSubtask = !!task.parent_id;
              const collapsed = collapsedIds.has(task.id);
              return (
                <li
                  key={task.id}
                  data-task-id={task.id}
                  data-parent-id={task.parent_id ?? ""}
                  data-depth={depth}
                  className={`task-row${selected ? " is-selected" : ""}${
                    task.status === "done" ? " is-done" : ""
                  }${isDragging ? " is-dragging" : ""}${
                    showBefore ? " drop-before" : ""
                  }${showAfter ? " drop-after" : ""}${
                    isSubtask ? " is-child" : ""
                  }`}
                  style={{ ["--task-depth" as string]: String(depth) }}
                  onPointerDown={(e) => armRowPointer(e, task)}
                  onClick={(e) => onRowClick(e, task)}
                  onDoubleClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (
                      target.closest(
                        ".task-check, .task-play, .task-toggle, .task-actions, .category-picker, .clock-estimate-picker, input, textarea",
                      )
                    ) {
                      return;
                    }
                    setDetailTask(task);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setRowMenu({ task, x: e.clientX, y: e.clientY });
                  }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      className={`task-toggle${collapsed ? " is-collapsed" : ""}`}
                      title={collapsed ? "展开子任务" : "折叠子任务"}
                      aria-label={collapsed ? "展开子任务" : "折叠子任务"}
                      aria-expanded={!collapsed}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapsed(task.id);
                      }}
                    >
                      {collapsed ? "▶" : "▼"}
                    </button>
                  ) : (
                    <span className="task-toggle-spacer" aria-hidden />
                  )}
                  <button
                    type="button"
                    className="drag-handle"
                    title={
                      isSubtask
                        ? "按住拖动调整子任务排序"
                        : "按住拖动调整优先级或排序"
                    }
                    aria-label={`拖动「${task.title}」调整位置`}
                    disabled={busy}
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
                  <div className="task-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailTask(task);
                      }}
                      disabled={busy}
                    >
                      编辑
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
            <span className="stat-label">今日番茄</span>
            <strong>{formatPomodoroAmount(categoryStats.todayFocusSessions)}</strong>
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

      <div className="task-list-toolbar">
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
      <div className="task-tree-actions">
        <button
          type="button"
          className="secondary-btn task-tree-btn"
          onClick={expandAllSubtasks}
          title="展开所有子任务"
          aria-label="展开所有子任务"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
            <path
              d="M3.2 4.2 8 8.4l4.8-4.2M3.2 8.2 8 12.4l4.8-4.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="secondary-btn task-tree-btn"
          onClick={collapseAllSubtasks}
          title="收起所有子任务"
          aria-label="收起所有子任务"
        >
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
            <path
              d="M3.2 7.8 8 3.6l4.8 4.2M3.2 11.8 8 7.6l4.8 4.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
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
        categories={categories}
        onClose={() => setDetailTask(null)}
        onSave={saveTaskDetail}
        onCreateSubtask={
          detailTask
            ? (title) => handleCreateSubtask(detailTask, title)
            : undefined
        }
        onRequestCreateCategory={() => openCreateCategory("detail")}
        onRequestEditCategory={openEditCategory}
        pickedCategory={pickedCategory}
      />

      <CreateSubtaskDialog
        open={!!subtaskParent}
        onClose={() => setSubtaskParent(null)}
        onCreate={async (title) => {
          if (!subtaskParent) return;
          await handleCreateSubtask(subtaskParent, title);
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
            setPendingDeleteTask(rowMenu.task);
            setRowMenu(null);
          }}
        />
      )}

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
              <p>
                确定删除任务「{pendingDeleteTask.title}」
                {tasks.some((task) => task.parent_id === pendingDeleteTask.id)
                  ? "及其所有子任务"
                  : ""}
                ？此操作不可撤销。
              </p>
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
