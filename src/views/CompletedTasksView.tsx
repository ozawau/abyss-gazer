import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CreateSubtaskDialog } from "../components/CreateSubtaskDialog";
import { TaskDetailDialog, type TaskDetailSave } from "../components/TaskDetailDialog";
import { TaskPomodoroClocks } from "../components/ClockEstimate";
import { TaskHoverCard, useTaskHover } from "../components/TaskHoverCard";
import { TaskLineageTitle } from "../components/TaskLineageTitle";
import { TaskRowMenu } from "../components/TaskRowMenu";
import { useI18n } from "../components/LocaleProvider";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { formatDateTime } from "../lib/dateDisplay";
import {
  Category,
  createTask,
  deleteTask,
  listCategories,
  Task,
  updateTask,
} from "../lib/api";
import {
  applyAncestorFields,
  ancestorTasks,
  formatTaskLineage,
  removeTaskTree,
  taskById,
} from "../lib/taskTree";
import { isAndroidDevice } from "../lib/viewport";
import { isInTemplateTree } from "../lib/taskRecurrence";

const PAGE_SIZE = 15;

interface CompletedTasksViewProps {
  tasks: Task[];
  onTasksChange: (tasks: Task[]) => void;
  onOpenTemplate?: (templateId: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (filter: string) => void;
  dataEpoch: number;
  checkinCategoryId?: string | null;
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

export function CompletedTasksView({
  tasks,
  onTasksChange,
  onOpenTemplate,
  categoryFilter,
  onCategoryFilterChange,
  dataEpoch,
  checkinCategoryId = null,
}: CompletedTasksViewProps) {
  const { locale, t } = useI18n();
  const android = isAndroidDevice();
  const {
    hoverTaskId,
    hoverCardRef,
    cancelHoverHide,
    scheduleHoverHide,
    dismissHover,
    rowPointerHandlers,
  } = useTaskHover(android);
  const [categories, setCategories] = useState<Category[]>([]);
  const [titleQuery, setTitleQuery] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [completedFrom, setCompletedFrom] = useState("");
  const [completedTo, setCompletedTo] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement>(null);
  useDismissOnAndroidBack(pendingDelete != null, () => {
    if (!busy) setPendingDelete(null);
  }, deleteDialogRef);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    task: Task;
    x: number;
    y: number;
  } | null>(null);
  const [subtaskParent, setSubtaskParent] = useState<Task | null>(null);

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
  }, [dataEpoch]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const tasksById = useMemo(() => taskById(tasks), [tasks]);

  const completedChildCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.status !== "done" || isInTemplateTree(task, tasksById)) continue;
      for (const ancestor of ancestorTasks(task, tasksById)) {
        if (isInTemplateTree(ancestor, tasksById)) continue;
        counts.set(ancestor.id, (counts.get(ancestor.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [tasks, tasksById]);

  const parentChoices = useMemo(() => {
    return [...completedChildCounts.entries()]
      .flatMap(([id, count]) => {
        const task = tasksById.get(id);
        return task ? [{ task, count }] : [];
      })
      .sort((a, b) =>
        formatTaskLineage(a.task, tasksById).localeCompare(
          formatTaskLineage(b.task, tasksById),
          locale,
        ),
      );
  }, [completedChildCounts, tasksById, locale]);

  useEffect(() => {
    if (parentId && !tasksById.has(parentId)) setParentId(null);
  }, [parentId, tasksById]);

  const filtered = useMemo(() => {
    const q = titleQuery.trim().toLowerCase();
    const completedStart = startOfDayMs(completedFrom);
    const completedEnd = endOfDayMs(completedTo);
    const createdStart = startOfDayMs(createdFrom);
    const createdEnd = endOfDayMs(createdTo);

    return tasks
      .filter((t) => t.status === "done" && !isInTemplateTree(t, tasksById))
      .filter((t) => {
        if (parentId) {
          const underParent = ancestorTasks(t, tasksById).some((item) => item.id === parentId);
          if (!underParent) return false;
        }
        if (q && !t.title.toLowerCase().includes(q)) return false;
        if (categoryFilter === "none" && t.category_id) return false;
        if (
          categoryFilter !== "all" &&
          categoryFilter !== "none" &&
          t.category_id !== categoryFilter
        ) {
          return false;
        }
        const completedAt = t.completed_at ?? t.updated_at;
        if (completedStart != null && completedAt < completedStart) return false;
        if (completedEnd != null && completedAt > completedEnd) return false;
        if (createdStart != null && t.created_at < createdStart) return false;
        if (createdEnd != null && t.created_at > createdEnd) return false;
        return true;
      })
      .sort((a, b) => {
        const ac = a.completed_at ?? a.updated_at;
        const bc = b.completed_at ?? b.updated_at;
        return bc - ac;
      });
  }, [
    tasks,
    tasksById,
    parentId,
    titleQuery,
    categoryFilter,
    completedFrom,
    completedTo,
    createdFrom,
    createdTo,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    parentId,
    titleQuery,
    categoryFilter,
    completedFrom,
    completedTo,
    createdFrom,
    createdTo,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const hoverTask = hoverTaskId
    ? tasks.find((task) => task.id === hoverTaskId) ?? null
    : null;

  useEffect(() => {
    if (!hoverTaskId) return;
    if (pageItems.some((task) => task.id === hoverTaskId)) return;
    dismissHover();
  }, [hoverTaskId, pageItems, dismissHover]);

  async function restoreTask(task: Task) {
    setBusy(true);
    setError(null);
    try {
      const next = await updateTask({ id: task.id, status: "todo" });
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
      recurrence: input.recurrence,
      ...(input.checkin_weekdays !== undefined
        ? { checkin_weekdays: input.checkin_weekdays }
        : {}),
    });
    onTasksChange(applyAncestorFields(tasks, next));
    setDetailTask(next);
  }

  function clearFilters() {
    setTitleQuery("");
    setParentId(null);
    onCategoryFilterChange("all");
    setCompletedFrom("");
    setCompletedTo("");
    setCreatedFrom("");
    setCreatedTo("");
  }

  return (
    <div className="view completed-tasks-view">
      <header className="view-header">
        <h1>{t("completed.title")}</h1>
        <p>{t("completed.hint")}</p>
      </header>

      <div className="completed-filters">
        <label className="completed-filter-field">
          <span>{t("common.taskName")}</span>
          <input
            value={titleQuery}
            onChange={(e) => setTitleQuery(e.target.value)}
            placeholder={t("common.searchTitle")}
          />
        </label>
        <div className="completed-filter-field">
          <span>{t("completed.parent")}</span>
          <ParentTaskPicker
            value={parentId}
            choices={parentChoices}
            tasksById={tasksById}
            onChange={setParentId}
          />
        </div>
        <label className="completed-filter-field">
          <span>{t("common.category")}</span>
          <select
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value)}
          >
            <option value="all">{t("common.all")}</option>
            <option value="none">{t("common.uncategorized")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="completed-filter-field">
          <span>{t("completed.completedDate")}</span>
          <div className="completed-date-range">
            <input
              type="date"
              value={completedFrom}
              onChange={(e) => setCompletedFrom(e.target.value)}
              aria-label={t("completed.completedFrom")}
            />
            <span className="completed-date-sep">{t("common.to")}</span>
            <input
              type="date"
              value={completedTo}
              onChange={(e) => setCompletedTo(e.target.value)}
              aria-label={t("completed.completedTo")}
            />
          </div>
        </div>
        <div className="completed-filter-field">
          <span>{t("upcoming.createdDate")}</span>
          <div className="completed-date-range">
            <input
              type="date"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
              aria-label={t("upcoming.createdFrom")}
            />
            <span className="completed-date-sep">{t("common.to")}</span>
            <input
              type="date"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
              aria-label={t("upcoming.createdTo")}
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
            {t("upcoming.clear")}
          </button>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <div className="completed-list-meta">
        {t("common.countItems", { count: filtered.length })}
        {filtered.length > 0 && (
          <>
            {t("common.pageOf", { page: safePage, pages: totalPages })}
          </>
        )}
      </div>

      {pageItems.length === 0 ? (
        <p className="completed-empty">{t("completed.empty")}</p>
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
                {...rowPointerHandlers(task.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setRowMenu({ task, x: e.clientX, y: e.clientY });
                }}
              >
                <div className="completed-row-main">
                  <TaskLineageTitle
                    task={task}
                    byId={tasksById}
                    onAncestorClick={(ancestor) => setParentId(ancestor.id)}
                  />
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
                      <span className="completed-meta-muted">{t("common.uncategorized")}</span>
                    )}
                    <TaskPomodoroClocks
                      estimate={task.estimate_pomodoros ?? 0}
                      completed={task.completed_pomodoros ?? 0}
                    />
                    <span>
                      {t("completed.finished", { time: formatDateTime(task.completed_at ?? task.updated_at, locale) })}
                    </span>
                    <span>{t("common.createdAt", { time: formatDateTime(task.created_at, locale) })}</span>
                  </div>
                </div>
                <div className="completed-row-actions">
                  {(completedChildCounts.get(task.id) ?? 0) > 0 && (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={busy}
                      onClick={() => setParentId(task.id)}
                    >
                      {t("completed.subtasks")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => setDetailTask(task)}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={busy}
                    onClick={() => void restoreTask(task)}
                  >
                    {t("completed.restore")}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn danger"
                    disabled={busy}
                    onClick={() => setPendingDelete(task)}
                  >
                    {t("common.delete")}
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
            {t("common.prevPage")}
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
            {t("common.nextPage")}
          </button>
        </div>
      )}

      {pendingDelete && (
        <div
          ref={deleteDialogRef}
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
            <h2>{t("common.deleteTask")}</h2>
            <div className="delete-confirm">
              <p>{t("common.deleteTaskBody", { title: pendingDelete.title })}</p>
              <div className="delete-confirm-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={busy}
                  onClick={() => setPendingDelete(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busy}
                  onClick={() => void confirmDelete()}
                >
                  {t("common.confirmDelete")}
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
        checkinCategoryId={checkinCategoryId}
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

      {hoverTask && (
        <TaskHoverCard
          cardRef={hoverCardRef}
          task={hoverTask}
          parents={ancestorTasks(hoverTask, tasksById).reverse()}
          category={
            hoverTask.category_id
              ? categoryMap.get(hoverTask.category_id) ?? null
              : null
          }
          pinned={android}
          onDismiss={dismissHover}
          onHoverStart={android ? undefined : cancelHoverHide}
          onHoverEnd={android ? undefined : scheduleHoverHide}
        />
      )}

      {rowMenu && (
        <TaskRowMenu
          x={rowMenu.x}
          y={rowMenu.y}
          onClose={() => setRowMenu(null)}
          onEdit={() => {
            setDetailTask(rowMenu.task);
            setRowMenu(null);
          }}
          onOpenTemplate={
            onOpenTemplate &&
            rowMenu.task.recurrence_source_id &&
            tasksById.has(rowMenu.task.recurrence_source_id)
              ? () => {
                  const templateId = rowMenu.task.recurrence_source_id;
                  setRowMenu(null);
                  if (templateId) onOpenTemplate(templateId);
                }
              : undefined
          }
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

function ParentTaskPicker({
  value,
  choices,
  tasksById,
  onChange,
}: {
  value: string | null;
  choices: { task: Task; count: number }[];
  tasksById: Map<string, Task>;
  onChange: (id: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useDismissOnAndroidBack(open, () => setOpen(false), menuRef);

  const selected = value ? tasksById.get(value) ?? null : null;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? choices.filter((choice) =>
        formatTaskLineage(choice.task, tasksById).toLowerCase().includes(needle),
      )
    : choices;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = rootRef.current?.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(320, Math.max(rect.width, 240));
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(160, Math.min(320, (openUp ? spaceAbove : spaceBelow) - 12));
      setMenuStyle({
        position: "fixed",
        left,
        width,
        top: openUp ? undefined : rect.bottom + 4,
        bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
        maxHeight,
        zIndex: 90,
      });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(id: string | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef}>
      <button
        type="button"
        className={`completed-parent-trigger${selected ? "" : " is-empty"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={
          selected
            ? `${t("completed.parent")}: ${formatTaskLineage(selected, tasksById)}`
            : t("completed.parent")
        }
        title={selected ? formatTaskLineage(selected, tasksById) : t("completed.parentAll")}
        onClick={() => {
          setOpen((current) => !current);
          if (open) setQuery("");
        }}
      >
        <span>{selected ? formatTaskLineage(selected, tasksById) : t("completed.parentAll")}</span>
        <span className="completed-parent-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="completed-parent-menu"
            role="listbox"
            aria-label={t("completed.parent")}
            style={menuStyle}
          >
            <input
              ref={searchRef}
              className="completed-parent-search"
              value={query}
              placeholder={t("completed.parentSearch")}
              aria-label={t("completed.parentSearch")}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="completed-parent-options">
              <button
                type="button"
                className={`completed-parent-option${selected ? "" : " is-active"}`}
                role="option"
                aria-selected={!selected}
                onClick={() => choose(null)}
              >
                {t("completed.parentAll")}
              </button>
              {visible.length === 0 ? (
                <p className="completed-parent-empty">{t("completed.parentNone")}</p>
              ) : (
                visible.map((choice) => (
                  <button
                    key={choice.task.id}
                    type="button"
                    className={`completed-parent-option${
                      choice.task.id === value ? " is-active" : ""
                    }`}
                    role="option"
                    aria-selected={choice.task.id === value}
                    title={formatTaskLineage(choice.task, tasksById)}
                    onClick={() => choose(choice.task.id)}
                  >
                    <span>{formatTaskLineage(choice.task, tasksById)}</span>
                    <small>{t("completed.parentMatch", { count: choice.count })}</small>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
