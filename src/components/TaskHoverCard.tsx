import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { useI18n } from "./LocaleProvider";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { formatDateTime } from "../lib/dateDisplay";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
import { parseTaskRecurrence, recurrenceLabel } from "../lib/taskRecurrence";
import type { Category, Task } from "../lib/api";

const HOVER_ROW_SELECTOR = ".task-hover-card, .task-row, .completed-row";

export function placeAnchoredTaskCard(el: HTMLDivElement | null, anchor: DOMRect) {
  if (!el) return;
  const margin = 8;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  let top = anchor.bottom + 8;
  if (top + height > window.innerHeight - margin) {
    top = anchor.top - height - 8;
  }
  if (top < margin) top = margin;
  const left = Math.min(
    Math.max(margin, anchor.left),
    Math.max(margin, window.innerWidth - width - margin),
  );
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function placeTaskHoverCard(el: HTMLDivElement | null, x: number, y: number) {
  if (!el) return;
  const margin = 8;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const left = Math.min(
    Math.max(margin, x + 14),
    Math.max(margin, window.innerWidth - width - margin),
  );
  const top = Math.min(
    Math.max(margin, y + 16),
    Math.max(margin, window.innerHeight - height - margin),
  );
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function TaskHoverCard({
  cardRef,
  task,
  parents,
  category,
  pinned,
  onDismiss,
  onHoverStart,
  onHoverEnd,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  task: Task;
  parents: Task[];
  category: Category | null;
  pinned: boolean;
  onDismiss: () => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
}) {
  const { locale, t } = useI18n();
  useDismissOnAndroidBack(pinned, onDismiss, cardRef);
  const notes = task.notes.trim();
  return (
    <div
      ref={cardRef}
      className={`task-hover-card${pinned ? " is-pinned" : ""}`}
      role="tooltip"
      onMouseEnter={onHoverStart}
      onMouseLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Element && next.closest(".task-row, .completed-row")) return;
        onHoverEnd?.();
      }}
    >
      <strong>{task.title}</strong>
      {(() => {
        const rule = parseTaskRecurrence(task.recurrence);
        if (!rule) return null;
        return <p>{recurrenceLabel(rule, locale, t)}</p>;
      })()}
      {parents.length > 0 && (
        <p className="task-hover-parents">
          <span>{t("tasks.parents")}</span>
          {parents.map((parent) => (
            <span key={parent.id}>{parent.title}</span>
          ))}
        </p>
      )}
      <p className="task-hover-category">
        <span>{t("common.category")}</span>
        {category ? (
          <>
            <span
              className="category-swatch"
              style={{ background: category.color }}
              aria-hidden
            />
            <span>{category.name}</span>
          </>
        ) : (
          <span>{t("common.noCategory")}</span>
        )}
      </p>
      <p>
        {t("clock.progress", {
          done: formatPomodoroAmount(task.completed_pomodoros ?? 0),
          estimate: task.estimate_pomodoros ?? 0,
        })}
      </p>
      <p>
        {t("detail.start")} {formatDateTime(task.start_at, locale)}
      </p>
      <p>
        {t("detail.due")} {formatDateTime(task.due_at, locale)}
      </p>
      {notes && (
        <p>
          {t("detail.notes")}
          <span className="task-hover-notes">{notes}</span>
        </p>
      )}
    </div>
  );
}

export function useTaskHover(android: boolean) {
  const [hoverTaskId, setHoverTaskId] = useState<string | null>(null);
  const hoverPos = useRef({ x: 0, y: 0 });
  const hoverAnchor = useRef<DOMRect | null>(null);
  const hoverCardRef = useRef<HTMLDivElement>(null);
  const hoverHideTimer = useRef<number | null>(null);

  const cancelHoverHide = useCallback(() => {
    if (hoverHideTimer.current == null) return;
    window.clearTimeout(hoverHideTimer.current);
    hoverHideTimer.current = null;
  }, []);

  const dismissHover = useCallback(() => {
    cancelHoverHide();
    hoverAnchor.current = null;
    setHoverTaskId(null);
  }, [cancelHoverHide]);

  const scheduleHoverHide = useCallback(() => {
    cancelHoverHide();
    hoverHideTimer.current = window.setTimeout(() => {
      hoverHideTimer.current = null;
      setHoverTaskId(null);
    }, 280);
  }, [cancelHoverHide]);

  function showTaskHover(id: string, x: number, y: number) {
    cancelHoverHide();
    if (hoverTaskId === id) return;
    hoverPos.current = { x, y };
    setHoverTaskId(id);
    placeTaskHoverCard(hoverCardRef.current, x, y);
  }

  function openPinnedCard(id: string, row: HTMLElement) {
    if (hoverTaskId === id) {
      dismissHover();
      return;
    }
    const anchor = row.getBoundingClientRect();
    hoverAnchor.current = anchor;
    setHoverTaskId(id);
    placeAnchoredTaskCard(hoverCardRef.current, anchor);
  }

  useLayoutEffect(() => {
    if (!hoverTaskId) return;
    const card = hoverCardRef.current;
    if (card) card.scrollTop = 0;
    if (android && hoverAnchor.current) {
      placeAnchoredTaskCard(card, hoverAnchor.current);
    } else {
      placeTaskHoverCard(card, hoverPos.current.x, hoverPos.current.y);
    }
  }, [hoverTaskId, android]);

  useEffect(() => () => cancelHoverHide(), [cancelHoverHide]);

  useEffect(() => {
    if (!android || !hoverTaskId) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(HOVER_ROW_SELECTOR)) return;
      hoverAnchor.current = null;
      setHoverTaskId(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [android, hoverTaskId]);

  function rowPointerHandlers(taskId: string) {
    if (android) {
      return {
        onClick: (event: ReactMouseEvent<HTMLElement>) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.closest("button, a, input, textarea, select")) return;
          openPinnedCard(taskId, event.currentTarget);
        },
      };
    }
    return {
      onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => {
        showTaskHover(taskId, event.clientX, event.clientY);
      },
      onMouseLeave: (event: ReactMouseEvent<HTMLElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Element && next.closest(HOVER_ROW_SELECTOR)) return;
        scheduleHoverHide();
      },
    };
  }

  return {
    hoverTaskId,
    hoverCardRef,
    cancelHoverHide,
    scheduleHoverHide,
    dismissHover,
    rowPointerHandlers,
  };
}
