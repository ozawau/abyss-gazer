import { useEffect, useMemo, useRef, useState } from "react";
import type { Category, Task } from "../lib/api";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import {
  descendantIds,
  flattenTaskTree,
  taskById,
  type TaskNode,
} from "../lib/taskTree";
import { useI18n } from "./LocaleProvider";

const PRIORITY_ORDER = ["high", "medium", "low"] as const;
const UNCATEGORIZED_DOT = "#94a3b8";

type CategoryFilter = "all" | "none" | string;

interface ReparentTaskDialogProps {
  open: boolean;
  task: Task | null;
  tasks: Task[];
  categories: Category[];
  onClose: () => void;
  onPick: (parentId: string) => Promise<void>;
}

function sortRoots(roots: Task[]): Task[] {
  return [...roots].sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(
      (a.priority as (typeof PRIORITY_ORDER)[number]) ?? "medium",
    );
    const pb = PRIORITY_ORDER.indexOf(
      (b.priority as (typeof PRIORITY_ORDER)[number]) ?? "medium",
    );
    const pi = (pa >= 0 ? pa : 1) - (pb >= 0 ? pb : 1);
    if (pi !== 0) return pi;
    return a.sort_order - b.sort_order || a.created_at - b.created_at;
  });
}

function categoryColor(categories: Category[], categoryId: string | null): string {
  if (!categoryId) return UNCATEGORIZED_DOT;
  return categories.find((c) => c.id === categoryId)?.color ?? UNCATEGORIZED_DOT;
}

function visibleTaskIds(tasks: Task[], filter: CategoryFilter): Set<string> | null {
  if (filter === "all") return null;
  const matches = (row: Task) =>
    filter === "none" ? !row.category_id : row.category_id === filter;
  const visible = new Set<string>();
  for (const row of tasks) {
    if (matches(row)) visible.add(row.id);
  }
  const byId = taskById(tasks);
  for (const id of [...visible]) {
    let current = byId.get(id);
    while (current?.parent_id) {
      visible.add(current.parent_id);
      current = byId.get(current.parent_id);
    }
  }
  return visible;
}

export function ReparentTaskDialog({
  open,
  task,
  tasks,
  categories,
  onClose,
  onPick,
}: ReparentTaskDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [pendingParent, setPendingParent] = useState<Task | null>(null);
  const [confirming, setConfirming] = useState(false);
  useDismissOnAndroidBack(open, () => {
    if (pendingParent) setPendingParent(null);
    else onClose();
  }, rootRef);

  useEffect(() => {
    if (!open) return;
    setCategoryFilter("all");
    setCollapsedIds(new Set());
    setPendingParent(null);
    setConfirming(false);
  }, [open, task?.id]);

  const openTasks = useMemo(
    () => tasks.filter((row) => row.status !== "done"),
    [tasks],
  );

  const openTaskIds = useMemo(
    () => new Set(openTasks.map((row) => row.id)),
    [openTasks],
  );

  const showUncategorizedFilter = useMemo(
    () => openTasks.some((row) => !row.category_id),
    [openTasks],
  );

  const nodes = useMemo((): TaskNode[] => {
    if (!task) return [];
    const blocked = new Set([task.id, ...descendantIds(task.id, tasks)]);
    const allowed = visibleTaskIds(openTasks, categoryFilter);
    const roots = sortRoots(
      openTasks.filter(
        (row) =>
          !blocked.has(row.id) &&
          (!row.parent_id || !openTaskIds.has(row.parent_id)),
      ),
    );
    return flattenTaskTree(openTasks, collapsedIds, roots).filter((node) => {
      if (blocked.has(node.task.id)) return false;
      if (allowed && !allowed.has(node.task.id)) return false;
      return true;
    });
  }, [task, tasks, openTasks, openTaskIds, categoryFilter, collapsedIds]);

  function toggleCollapsed(taskId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  async function confirmPick() {
    if (!pendingParent || confirming) return;
    setConfirming(true);
    try {
      await onPick(pendingParent.id);
    } finally {
      setConfirming(false);
    }
  }

  if (!open || !task) return null;

  return (
    <div
      ref={rootRef}
      className="modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal-card reparent-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reparent-task-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="reparent-task-title">{t("tasks.attachAsSubtask")}</h2>
        <p className="reparent-task-source">
          {t("tasks.attachAsSubtaskSource", { title: task.title })}
        </p>
        {!pendingParent ? (
          <>
            <p className="reparent-task-hint">{t("tasks.attachAsSubtaskHint")}</p>

            <div
              className="category-filter reparent-task-filter"
              role="toolbar"
              aria-label={t("tasks.filter")}
            >
              <button
                type="button"
                className={`filter-chip${categoryFilter === "all" ? " is-active" : ""}`}
                onClick={() => setCategoryFilter("all")}
              >
                {t("common.all")}
              </button>
              {showUncategorizedFilter && (
                <button
                  type="button"
                  className={`filter-chip${categoryFilter === "none" ? " is-active" : ""}`}
                  onClick={() => setCategoryFilter("none")}
                >
                  {t("common.uncategorized")}
                </button>
              )}
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`filter-chip${categoryFilter === category.id ? " is-active" : ""}`}
                  onClick={() => setCategoryFilter(category.id)}
                >
                  <span
                    className="category-swatch"
                    style={{ background: category.color }}
                    aria-hidden
                  />
                  {category.name}
                </button>
              ))}
            </div>

            {nodes.length === 0 ? (
              <p className="reparent-task-empty">
                {categoryFilter === "all"
                  ? t("tasks.attachAsSubtaskEmpty")
                  : t("tasks.attachAsSubtaskFilterEmpty")}
              </p>
            ) : (
              <ul
                className="reparent-task-tree"
                role="listbox"
                aria-label={t("tasks.chooseParent")}
              >
                {nodes.map((node) => {
                  const collapsed = collapsedIds.has(node.task.id);
                  const dot = categoryColor(categories, node.task.category_id);
                  return (
                    <li key={node.task.id} role="none" className="reparent-task-item">
                      <div
                        className="reparent-task-line"
                        style={{ paddingInlineStart: `${6 + node.depth * 18}px` }}
                      >
                        {node.hasChildren ? (
                          <button
                            type="button"
                            className={`reparent-task-toggle${collapsed ? " is-collapsed" : ""}`}
                            aria-expanded={!collapsed}
                            aria-label={
                              collapsed
                                ? t("tasks.expandChildren")
                                : t("tasks.collapseChildren")
                            }
                            onClick={() => toggleCollapsed(node.task.id)}
                          >
                            {collapsed ? "▶" : "▼"}
                          </button>
                        ) : (
                          <span className="reparent-task-toggle-spacer" aria-hidden />
                        )}
                        <button
                          type="button"
                          role="option"
                          className="reparent-task-row"
                          onClick={() => setPendingParent(node.task)}
                        >
                          <span
                            className="category-swatch reparent-task-dot"
                            style={{ background: dot }}
                            aria-hidden
                          />
                          <span className="reparent-task-title">{node.task.title}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-btn" onClick={onClose}>
                {t("common.cancel")}
              </button>
            </div>
          </>
        ) : (
          <div className="reparent-task-confirm">
            <p className="reparent-task-confirm-body">
              {t("tasks.attachAsSubtaskConfirm", {
                child: task.title,
                parent: pendingParent.title,
              })}
            </p>
            <p className="reparent-task-hint">{t("tasks.attachAsSubtaskHint")}</p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={confirming}
                onClick={() => setPendingParent(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={confirming}
                onClick={() => void confirmPick()}
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
