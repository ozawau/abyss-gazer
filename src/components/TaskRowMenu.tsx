import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { TaskPriority } from "../lib/api";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { useI18n } from "./LocaleProvider";

export type TaskMoveAction = "top" | "up" | "down" | "bottom";

interface TaskRowMenuProps {
  x: number;
  y: number;
  onEdit: () => void;
  onCreateSubtask: () => void;
  onDelete: () => void;
  onClose: () => void;
  priorityMenu?: {
    current: TaskPriority;
    enabled: boolean;
    onSelect: (priority: TaskPriority) => void;
  };
  moveMenu?: {
    canTop: boolean;
    canUp: boolean;
    canDown: boolean;
    canBottom: boolean;
    onSelect: (action: TaskMoveAction) => void;
  };
}

const PRIORITY_ITEMS: { id: TaskPriority; label: "common.priorityHigh" | "common.priorityMedium" | "common.priorityLow" }[] = [
  { id: "high", label: "common.priorityHigh" },
  { id: "medium", label: "common.priorityMedium" },
  { id: "low", label: "common.priorityLow" },
];

function MenuBranch({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  const branchRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ left: false, up: false });
  useDismissOnAndroidBack(open, () => setOpen(false), branchRef);

  useLayoutEffect(() => {
    if (!open) return;
    const branch = branchRef.current;
    const flyout = branch?.querySelector(".task-menu-flyout");
    if (!branch || !(flyout instanceof HTMLElement)) return;
    const rect = branch.getBoundingClientRect();
    const flyoutRect = flyout.getBoundingClientRect();
    setPlace({
      left: rect.right + flyoutRect.width > window.innerWidth - 8,
      up: rect.top + flyoutRect.height > window.innerHeight - 8,
    });
  }, [open]);

  return (
    <div
      ref={branchRef}
      className={`task-menu-branch${place.left ? " opens-left" : ""}${place.up ? " opens-up" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{label}</span>
        <span aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="task-menu-flyout" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}

export function TaskRowMenu({
  x,
  y,
  onEdit,
  onCreateSubtask,
  onDelete,
  onClose,
  priorityMenu,
  moveMenu,
}: TaskRowMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useDismissOnAndroidBack(true, onClose, menuRef);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="task-context-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={onEdit}>
        {t("common.edit")}
      </button>
      <button type="button" role="menuitem" onClick={onCreateSubtask}>
        {t("detail.createSubtask")}
      </button>
      {priorityMenu && (
        <MenuBranch
          label={t("tasks.menuPriority")}
          title={priorityMenu.enabled ? undefined : t("tasks.priorityFollowsParent")}
        >
          {PRIORITY_ITEMS.map((item) => {
            const current = item.id === priorityMenu.current;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                className={current ? "is-current" : undefined}
                disabled={!priorityMenu.enabled}
                onClick={() => priorityMenu.onSelect(item.id)}
              >
                <span>{t(item.label)}</span>
                {current ? <span aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </MenuBranch>
      )}
      {moveMenu && (
        <MenuBranch label={t("tasks.menuMove")}>
          <button
            type="button"
            role="menuitem"
            disabled={!moveMenu.canTop}
            onClick={() => moveMenu.onSelect("top")}
          >
            {t("tasks.moveTop")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!moveMenu.canUp}
            onClick={() => moveMenu.onSelect("up")}
          >
            {t("tasks.moveUp")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!moveMenu.canDown}
            onClick={() => moveMenu.onSelect("down")}
          >
            {t("tasks.moveDown")}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!moveMenu.canBottom}
            onClick={() => moveMenu.onSelect("bottom")}
          >
            {t("tasks.moveBottom")}
          </button>
        </MenuBranch>
      )}
      <button type="button" role="menuitem" className="is-danger" onClick={onDelete}>
        {t("common.delete")}
      </button>
    </div>
  );
}
