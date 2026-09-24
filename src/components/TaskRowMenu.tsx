import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "./LocaleProvider";

interface TaskRowMenuProps {
  x: number;
  y: number;
  onEdit: () => void;
  onCreateSubtask: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function TaskRowMenu({
  x,
  y,
  onEdit,
  onCreateSubtask,
  onDelete,
  onClose,
}: TaskRowMenuProps) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

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
      <button type="button" role="menuitem" className="is-danger" onClick={onDelete}>
        {t("common.delete")}
      </button>
    </div>
  );
}
