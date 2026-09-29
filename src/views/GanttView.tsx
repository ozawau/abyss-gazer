import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Category,
  listCategories,
  listFirstCompletedFocusStarts,
  listPomodoroSessionsInRange,
  PomodoroSession,
  Task,
} from "../lib/api";
import {
  addDays,
  addMonths,
  startOfLocalDay,
  type WeekStartsOn,
} from "../lib/calendar";
import { formatShortDate } from "../lib/dateDisplay";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
import { FullscreenIcon } from "../components/FullscreenIcon";
import { useI18n } from "../components/LocaleProvider";
import type { AppLocale } from "../lib/i18n";
import { ANDROID_BACK_EVENT, useDismissOnAndroidBack } from "../lib/androidBack";
import { isAndroidDevice, useNarrowViewport } from "../lib/viewport";
import {
  buildGanttDayRange,
  buildGanttRange,
  daysBetween,
  formatGanttSpan,
  formatGanttTitle,
  ganttActivityMarks,
  ganttBarLayout,
  ganttContinuousBarLayout,
  ganttColumnIsToday,
  ganttParentRows,
  ganttRangeQueryMs,
  ganttTaskColor,
  sortGanttParentRows,
  taskVisibleOnGantt,
  todayOffsetPx,
  type GanttActivityMode,
  type GanttColumn,
  type GanttParentRow,
  type GanttRange,
  type GanttScale,
} from "../lib/gantt";

interface GanttViewProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onStartPomodoro: (taskId: string) => void;
  weekStartsOn: WeekStartsOn;
  activityMode: GanttActivityMode;
  onActivityModeChange: (mode: GanttActivityMode) => void;
  categoryFilter: string;
  onCategoryFilterChange: (filter: string) => void;
  dataEpoch: number;
}

const SCALE_TABS: { id: GanttScale }[] = [
  { id: "week" },
  { id: "month" },
  { id: "quarter" },
];

export function GanttView({
  tasks,
  selectedTaskId,
  onSelectTask,
  onStartPomodoro,
  weekStartsOn,
  activityMode,
  onActivityModeChange,
  categoryFilter,
  onCategoryFilterChange,
  dataEpoch,
}: GanttViewProps) {
  const { locale, t } = useI18n();
  const android = isAndroidDevice();
  const narrow = useNarrowViewport();
  const desktopNarrow = narrow && !android;
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [scale, setScale] = useState<GanttScale | null>("week");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(
    null,
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [hideDone, setHideDone] = useState(false);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [firstFocusStarts, setFirstFocusStarts] = useState<
    Map<string, number>
  >(new Map());
  const [error, setError] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardBox, setBoardBox] = useState({ width: 0, height: 0 });
  const [timelineWidth, setTimelineWidth] = useState(0);
  const [boardFullscreen, setBoardFullscreen] = useState(false);

  useEffect(() => {
    if (!android) return;
    function onBack(event: Event) {
      if (!boardFullscreen) return;
      const slot = viewportRef.current?.closest(".view-slot");
      if (slot?.classList.contains("is-hidden")) return;
      event.preventDefault();
      setBoardFullscreen(false);
    }
    window.addEventListener(ANDROID_BACK_EVENT, onBack);
    return () => window.removeEventListener(ANDROID_BACK_EVENT, onBack);
  }, [android, boardFullscreen]);
  const [hover, setHover] = useState<{
    task: Task;
    parent: Task;
    x: number;
    y: number;
  } | null>(null);

  const toggleAndroidHover = useCallback(
    (task: Task, parent: Task, x: number, y: number) => {
      setHover((prev) =>
        prev?.task.id === task.id ? null : { task, parent, x, y },
      );
    },
    [],
  );

  useEffect(() => {
    if (!android || !hover) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(
          ".gantt-hover-card, .gantt-name, .gantt-bar, .gantt-mark, .gantt-week-title",
        )
      ) {
        return;
      }
      setHover(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [android, hover]);
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

  useEffect(() => {
    if (!desktopNarrow) return;
    setScale("week");
    setCustomRange(null);
  }, [desktopNarrow]);

  useLayoutEffect(() => {
    if (android) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const measure = () => {
        const next = {
          width: viewport.clientWidth,
          height: viewport.clientHeight,
        };
        setBoardBox((prev) =>
          prev.width === next.width && prev.height === next.height ? prev : next,
        );
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(viewport);
      return () => observer.disconnect();
    }

    const board = boardRef.current;
    if (!board) return;
    const measure = () => {
      const head = board.querySelector(".gantt-head");
      const width = head instanceof HTMLElement ? head.clientWidth : 0;
      if (width <= 0) return;
      setTimelineWidth((prev) => (prev === width ? prev : width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    return () => observer.disconnect();
  }, [android, desktopNarrow]);

  const baseRange = useMemo(() => {
    if (scale == null && customRange) {
      return buildGanttDayRange(customRange.start, customRange.end, locale);
    }
    return buildGanttRange(scale ?? "week", cursor, weekStartsOn, locale);
  }, [scale, cursor, weekStartsOn, customRange, locale]);

  const range = useMemo(() => {
    const count = Math.max(baseRange.columns.length, 1);
    if (android || timelineWidth <= 0) return baseRange;
    return { ...baseRange, columnWidth: timelineWidth / count };
  }, [android, baseRange, timelineWidth]);

  const focusRevision = useMemo(
    () => tasks.reduce((sum, task) => sum + (task.completed_pomodoros ?? 0), 0),
    [tasks],
  );

  useEffect(() => {
    let cancelled = false;
    listFirstCompletedFocusStarts()
      .then((rows) => {
        if (!cancelled) {
          setFirstFocusStarts(
            new Map(rows.map((row) => [row.task_id, row.started_at])),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [focusRevision, dataEpoch]);

  useEffect(() => {
    let cancelled = false;
    const { startMs, endMs } = ganttRangeQueryMs(baseRange);
    listPomodoroSessionsInRange(startMs, endMs)
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [baseRange, focusRevision, dataEpoch]);

  const sessionTaskIds = useMemo(
    () => new Set(sessions.map((session) => session.task_id)),
    [sessions],
  );

  function taskInGanttRange(task: Task): boolean {
    if (categoryFilter === "none" && task.category_id) return false;
    if (categoryFilter !== "all" && categoryFilter !== "none" && task.category_id !== categoryFilter) {
      return false;
    }
    if (
      activityMode === "continuous" &&
      ganttContinuousBarLayout(task, range, firstFocusStarts, today, sessions) != null
    ) {
      return true;
    }
    return taskVisibleOnGantt(task, range, sessionTaskIds);
  }

  function itemVisibleOnGantt(task: Task): boolean {
    if (hideDone && task.status === "done") return false;
    return taskInGanttRange(task);
  }

  const visibleRows = useMemo(() => {
    const rows = ganttParentRows(tasks)
      .map((row) => {
        const visibleItems = row.items.filter((item) => itemVisibleOnGantt(item));
        if (visibleItems.length > 0) return { ...row, items: visibleItems };
        const familyInRange =
          taskInGanttRange(row.parent) ||
          row.items.some((item) => taskInGanttRange(item));
        // Completed subtasks drop out of the lanes, but an unfinished parent
        // stays when this family still belongs in the current range.
        if (familyInRange && !(hideDone && row.parent.status === "done")) {
          return { ...row, items: [row.parent] };
        }
        return { ...row, items: [] };
      })
      .filter((row) => {
        if (row.items.length === 0) return false;
        if (hideDone && row.parent.status === "done" && row.items.every((item) => item.status === "done")) {
          return false;
        }
        if (categoryFilter === "none") return !row.parent.category_id;
        if (categoryFilter !== "all" && row.parent.category_id !== categoryFilter) {
          return false;
        }
        return true;
      });
    return sortGanttParentRows(rows, sessions);
  }, [
    tasks,
    hideDone,
    categoryFilter,
    activityMode,
    firstFocusStarts,
    today,
    range,
    sessionTaskIds,
    sessions,
  ]);

  const todayLeft = useMemo(
    () => todayOffsetPx(range, today),
    [range, today],
  );

  const title =
    scale == null
      ? formatGanttSpan(range, locale)
      : formatGanttTitle(scale, range, cursor, locale);
  const emptyMessage = t("gantt.empty");

  function applyCustom(start: Date, end: Date) {
    const from = startOfLocalDay(start);
    const to = startOfLocalDay(end);
    setScale(null);
    setCustomRange(
      from <= to ? { start: from, end: to } : { start: to, end: from },
    );
  }

  function goToday() {
    const now = startOfLocalDay(new Date());
    if (scale == null) {
      const span = daysBetween(range.start, range.end);
      applyCustom(addDays(now, -span), now);
      return;
    }
    setCursor(now);
  }

  function goPrev() {
    if (scale == null) {
      const span = daysBetween(range.start, range.end) + 1;
      applyCustom(addDays(range.start, -span), addDays(range.end, -span));
      return;
    }
    if (scale === "week") setCursor((d) => addDays(d, -14));
    else if (scale === "quarter") setCursor((d) => addMonths(d, -3));
    else setCursor((d) => addMonths(d, -1));
  }

  function goNext() {
    if (scale == null) {
      const span = daysBetween(range.start, range.end) + 1;
      applyCustom(addDays(range.start, span), addDays(range.end, span));
      return;
    }
    if (scale === "week") setCursor((d) => addDays(d, 14));
    else if (scale === "quarter") setCursor((d) => addMonths(d, 3));
    else setCursor((d) => addMonths(d, 1));
  }

  function setRangeBound(which: "start" | "end", value: string) {
    const day = parseDateInput(value);
    if (!day) return;
    const start = which === "start" ? day : range.start;
    const end = which === "end" ? day : range.end;
    applyCustom(start, end);
  }

  return (
    <div className="view gantt-view">
      <header className="view-header calendar-header">
        <div className="calendar-header-main">
          <h1>{t("gantt.title")}</h1>
          <p>{t("gantt.hint")}</p>
        </div>
        <div className="calendar-toolbar">
          <div
            className={`calendar-mode-tabs${desktopNarrow ? " is-hidden-narrow" : ""}`}
            role="tablist"
            aria-label={t("gantt.scale")}
          >
            {SCALE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={scale === tab.id}
                className={`calendar-mode-tab${scale === tab.id ? " is-active" : ""}`}
                onClick={() => {
                  if (scale == null) setCursor(startOfLocalDay(range.start));
                  setScale(tab.id);
                }}
              >
                {t(
                  tab.id === "week"
                    ? "gantt.fortnight"
                    : tab.id === "month"
                      ? "gantt.month"
                      : "gantt.quarter",
                )}
              </button>
            ))}
          </div>
          <div className="calendar-nav">
            <button type="button" className="secondary-btn" onClick={goPrev}>
              {t("common.prev")}
            </button>
            <button type="button" className="secondary-btn" onClick={goToday}>
              {t("common.today")}
            </button>
            <button type="button" className="secondary-btn" onClick={goNext}>
              {t("common.next")}
            </button>
          </div>
          {android && (
            <button
              type="button"
              className="secondary-btn gantt-fullscreen-btn"
              onClick={() => setBoardFullscreen(true)}
              title={t("gantt.fullscreen")}
              aria-label={t("gantt.fullscreen")}
            >
              <FullscreenIcon />
            </button>
          )}
        </div>
      </header>

      <div className="calendar-filters gantt-filters">
        <div className="gantt-filters-main">
          <strong className="calendar-period-title">{title}</strong>
          <label className="calendar-jump-field">
            <span>{t("gantt.start")}</span>
            <input
              type="date"
              className="calendar-jump-input calendar-jump-input-date"
              value={toDateInput(range.start)}
              onChange={(e) => setRangeBound("start", e.target.value)}
            />
          </label>
          <label className="calendar-jump-field">
            <span>{t("gantt.end")}</span>
            <input
              type="date"
              className="calendar-jump-input calendar-jump-input-date"
              value={toDateInput(range.end)}
              onChange={(e) => setRangeBound("end", e.target.value)}
            />
          </label>
          <label className="calendar-filter-field">
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
          <label className="calendar-filter-check">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            {t("common.hideDone")}
          </label>
        </div>
        <div
          className="gantt-activity-switch"
          role="radiogroup"
          aria-label={t("gantt.activity")}
        >
          {(["discrete", "continuous"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={activityMode === mode}
              className={`gantt-activity-switch-option${
                activityMode === mode ? " is-active" : ""
              }`}
              onClick={() => onActivityModeChange(mode)}
            >
              {mode === "discrete" ? t("gantt.discrete") : t("gantt.continuous")}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {visibleRows.length === 0 && (
        <p className="gantt-empty">{emptyMessage}</p>
      )}

      {desktopNarrow && visibleRows.length > 0 && (
        <ul className="gantt-week-list">
          {visibleRows.map((row) => (
            <GanttWeekGroup
              key={row.parent.id}
              row={row}
              onSelectTask={onSelectTask}
              onStartPomodoro={onStartPomodoro}
              onAndroidTapHover={android ? toggleAndroidHover : undefined}
            />
          ))}
        </ul>
      )}

      <div
        className={`gantt-board-viewport${
          android && boardFullscreen ? " is-fullscreen" : ""
        }`}
        ref={viewportRef}
      >
      <div
        className={`gantt-board${desktopNarrow ? " is-hidden-narrow" : ""}`}
        ref={boardRef}
        style={
          android
            ? {
                width: boardBox.height,
                height: boardBox.width,
                ["--gantt-col" as string]: `${range.columnWidth}px`,
              }
            : undefined
        }
      >
        <div className="gantt-scroll">
          <div className="gantt-grid">
            <div className="gantt-header-row">
              <div className="gantt-corner" />
              <div className="gantt-head">
                {range.columns.map((col) => (
                  <div
                    key={col.key}
                    className={`gantt-head-cell${col.isWeekend ? " is-weekend" : ""}${
                      ganttColumnIsToday(col, today, range.unitDays)
                        ? " is-today"
                        : ""
                    }`}
                  >
                    <span>{col.label}</span>
                    {col.sublabel && <em>{col.sublabel}</em>}
                  </div>
                ))}
              </div>
            </div>

              {visibleRows.map((row) => (
                <GanttParentRowView
                  key={row.parent.id}
                  row={row}
                  activityMode={activityMode}
                  range={range}
                  firstFocusStarts={firstFocusStarts}
                  today={today}
                  sessions={sessions}
                  categoryMap={categoryMap}
                  selectedTaskId={selectedTaskId}
                  todayLeft={todayLeft}
                  onSelectTask={onSelectTask}
                  onStartPomodoro={onStartPomodoro}
                  onHover={android ? undefined : setHover}
                  onAndroidTapHover={android ? toggleAndroidHover : undefined}
                />
              ))}
              {visibleRows.length === 0 && (
                <div className="gantt-row gantt-row-fill">
                  <div className="gantt-name-cell" />
                  <div className="gantt-track">
                    <GanttTrackBg
                      columns={range.columns}
                      todayLeft={todayLeft}
                    />
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>
      {android && boardFullscreen && (
        <button
          type="button"
          className="secondary-btn gantt-fullscreen-exit"
          onClick={() => setBoardFullscreen(false)}
          title={t("gantt.exitFullscreen")}
          aria-label={t("gantt.exitFullscreen")}
        >
          <FullscreenIcon exit />
        </button>
      )}
      </div>

      {hover && (
        <GanttTaskHover
          task={hover.task}
          parent={hover.parent}
          x={hover.x}
          y={hover.y}
          rotated={android}
          pinned={android}
          onDismiss={() => setHover(null)}
          category={
            hover.task.category_id
              ? categoryMap.get(hover.task.category_id) ?? null
              : null
          }
        />
      )}
    </div>
  );
}

function GanttWeekGroup({
  row,
  onSelectTask,
  onStartPomodoro,
  onAndroidTapHover,
}: {
  row: GanttParentRow;
  onSelectTask: (id: string | null) => void;
  onStartPomodoro: (taskId: string) => void;
  onAndroidTapHover?: (task: Task, parent: Task, x: number, y: number) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <li className="gantt-week-group">
      {row.items.map((task) => (
        <div
          key={task.id}
          className={`gantt-week-row${task.id !== row.parent.id ? " is-child" : ""}`}
        >
          <button
            type="button"
            className={`gantt-week-title${task.status === "done" ? " is-done" : ""}`}
            onClick={(e) => {
              onSelectTask(task.id);
              onAndroidTapHover?.(task, row.parent, e.clientX, e.clientY);
            }}
          >
            <span>{task.title}</span>
            <em>{taskSpanLabel(task, locale)}</em>
          </button>
          <button
            type="button"
            className="task-play"
            title={t("common.startPomodoro")}
            aria-label={t("tasks.focusTask", { title: task.title })}
            onClick={() => onStartPomodoro(task.id)}
          >
            ▶
          </button>
        </div>
      ))}
    </li>
  );
}

function taskSpanLabel(task: Task, locale: AppLocale): string {
  const start = task.start_at != null ? formatShortDate(task.start_at, locale) : "";
  const due = task.due_at != null ? formatShortDate(task.due_at, locale) : "";
  if (start && due) return `${start} – ${due}`;
  return start || due;
}

function formatGanttMarkCount(value: number): string {
  const tenths = Math.round(value * 10);
  if (!Number.isFinite(tenths)) return "0.0";
  return (tenths / 10).toFixed(1);
}

function occupiedSpan(lane: {
  bar: { left: number; width: number } | null;
  marks: { left: number; width: number }[];
}): { left: number; right: number } | null {
  let left = Infinity;
  let right = -Infinity;
  if (lane.bar) {
    left = Math.min(left, lane.bar.left);
    right = Math.max(right, lane.bar.left + lane.bar.width);
  }
  for (const mark of lane.marks) {
    left = Math.min(left, mark.left);
    right = Math.max(right, mark.left + mark.width);
  }
  if (right < left) return null;
  return { left, right };
}

/** Share a row when bars do not overlap, so idle days do not keep an empty lane. */
function packGanttLanes(
  lanes: {
    bar: { left: number; width: number } | null;
    marks: { left: number; width: number }[];
  }[],
): number[] {
  const placed = lanes
    .map((lane, index) => ({ index, span: occupiedSpan(lane) }))
    .filter((item): item is { index: number; span: { left: number; right: number } } => item.span != null)
    .sort((a, b) => a.span.left - b.span.left || a.span.right - b.span.right);
  const laneEnds: number[] = [];
  const assignment = lanes.map(() => 0);
  for (const item of placed) {
    const open = laneEnds.findIndex((end) => end <= item.span.left);
    const lane = open >= 0 ? open : laneEnds.length;
    laneEnds[lane] = item.span.right;
    assignment[item.index] = lane;
  }
  return assignment;
}

function GanttParentRowView({
  row,
  activityMode,
  range,
  firstFocusStarts,
  today,
  sessions,
  categoryMap,
  selectedTaskId,
  todayLeft,
  onSelectTask,
  onStartPomodoro,
  onHover,
  onAndroidTapHover,
}: {
  row: GanttParentRow;
  activityMode: GanttActivityMode;
  range: GanttRange;
  firstFocusStarts: ReadonlyMap<string, number>;
  today: Date;
  sessions: PomodoroSession[];
  categoryMap: Map<string, Category>;
  selectedTaskId: string | null;
  todayLeft: number | null;
  onSelectTask: (id: string | null) => void;
  onStartPomodoro: (taskId: string) => void;
  onHover?: (
    next: { task: Task; parent: Task; x: number; y: number } | null,
  ) => void;
  onAndroidTapHover?: (task: Task, parent: Task, x: number, y: number) => void;
}) {
  const { t } = useI18n();
  const { parent, items } = row;
  const lanes = items.map((task) => {
    const continuousBar =
      activityMode === "continuous"
        ? ganttContinuousBarLayout(task, range, firstFocusStarts, today, sessions)
        : null;
    return {
      task,
      continuousBar,
      bar: continuousBar ?? ganttBarLayout(task, range),
      marks:
        activityMode === "discrete"
          ? ganttActivityMarks(task, sessions, range)
          : [],
      color: ganttTaskColor(task.id),
    };
  });
  const laneIndex = packGanttLanes(lanes);
  const laneCount = Math.max(1, ...laneIndex.map((index) => index + 1));
  const stacked = laneCount > 1;
  const parentColor = ganttTaskColor(parent.id);
  const childCount = items.some((item) => item.id !== parent.id)
    ? items.length
    : 0;

  return (
    <div
      className={`gantt-row${stacked ? " is-stacked" : ""}`}
      style={{ minHeight: `${laneCount * 2.15}rem` }}
      onMouseLeave={() => onHover?.(null)}
    >
      <div
        className={`gantt-name-cell${
          selectedTaskId === parent.id ||
          items.some((item) => item.id === selectedTaskId)
            ? " is-selected"
            : ""
        }`}
      >
        <button
          type="button"
          className={`gantt-name${parent.status === "done" ? " is-done" : ""}`}
          onClick={(e) => {
            onSelectTask(parent.id);
            onAndroidTapHover?.(parent, parent, e.clientX, e.clientY);
          }}
          title={parent.title}
          onMouseEnter={(e) =>
            onHover?.({ task: parent, parent, x: e.clientX, y: e.clientY })
          }
          onMouseMove={(e) =>
            onHover?.({ task: parent, parent, x: e.clientX, y: e.clientY })
          }
        >
          <span
            className="gantt-name-swatch"
            style={{ background: parentColor }}
            aria-hidden
          />
          <span className="gantt-name-text">{parent.title}</span>
          {childCount > 0 && (
            <span className="gantt-sub-count">{childCount}</span>
          )}
        </button>
        {parent.status !== "done" && (
          <button
            type="button"
            className="gantt-name-play"
            title={t("common.startPomodoro")}
            onClick={() => onStartPomodoro(parent.id)}
          >
            ▶
          </button>
        )}
      </div>
      <div
        className="gantt-track"
        style={{ minHeight: `${laneCount * 2.15}rem` }}
        onClick={() => onSelectTask(parent.id)}
      >
        <GanttTrackBg
          columns={range.columns}
          todayLeft={todayLeft}
        />
        {lanes.map((lane, index) => {
          const category = lane.task.category_id
            ? categoryMap.get(lane.task.category_id)
            : null;
          if (!lane.bar && lane.marks.length === 0) return null;
          return (
            <div
              key={lane.task.id}
              className="gantt-lane"
              style={{
                top: `${laneIndex[index]! * 2.15}rem`,
                height: "2.15rem",
              }}
            >
              {lane.marks.map((mark) => (
                <span
                  key={mark.key}
                  className={`gantt-mark is-${mark.kind}${
                    lane.bar ? "" : " is-solo"
                  }${mark.count > 0 ? " has-count" : ""}`}
                  style={{
                    left: `${mark.left}px`,
                    width: `${mark.width}px`,
                    backgroundColor: lane.color,
                  }}
                  title={
                    mark.count > 0
                      ? t("calendar.pomodorosDone", { count: formatGanttMarkCount(mark.count) })
                      : mark.kind === "done"
                        ? t("gantt.finished")
                        : t("gantt.focused")
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTask(lane.task.id);
                    onAndroidTapHover?.(
                      lane.task,
                      parent,
                      e.clientX,
                      e.clientY,
                    );
                  }}
                  onMouseEnter={(e) => {
                    onHover?.({
                      task: lane.task,
                      parent,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onMouseMove={(e) => {
                    onHover?.({
                      task: lane.task,
                      parent,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  {mark.count > 0 ? formatGanttMarkCount(mark.count) : ""}
                </span>
              ))}
              {lane.bar && (
                <button
                  type="button"
                  className={`gantt-bar${
                    selectedTaskId === lane.task.id ? " is-selected" : ""
                  }${lane.task.status === "done" ? " is-done" : ""}${
                    lane.continuousBar ? " is-continuous" : ""
                  }${lane.bar.clippedStart ? " is-clip-start" : ""}${
                    lane.bar.clippedEnd ? " is-clip-end" : ""
                  }`}
                  style={{
                    left: `${lane.bar.left}px`,
                    width: `${lane.bar.width}px`,
                    backgroundColor: lane.color,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTask(lane.task.id);
                    onAndroidTapHover?.(
                      lane.task,
                      parent,
                      e.clientX,
                      e.clientY,
                    );
                  }}
                  onMouseEnter={(e) => {
                    onHover?.({
                      task: lane.task,
                      parent,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onMouseMove={(e) => {
                    onHover?.({
                      task: lane.task,
                      parent,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  <span className="gantt-bar-label">
                    {lane.task.title}
                    {category ? ` · ${category.name}` : ""}
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GanttTaskHover({
  task,
  parent,
  x,
  y,
  rotated,
  pinned,
  onDismiss,
  category,
}: {
  task: Task;
  parent: Task;
  x: number;
  y: number;
  rotated: boolean;
  pinned: boolean;
  onDismiss: () => void;
  category: Category | null;
}) {
  const { locale, t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  useDismissOnAndroidBack(true, onDismiss, cardRef);
  const [size, setSize] = useState({ width: 240, height: 120 });
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  });
  const { left, top } = rotated
    ? rotatedHoverPosition(x, y, size.width, size.height)
    : uprightHoverPosition(x, y);
  const priority =
    task.priority === "high"
      ? t("common.priorityHighShort")
      : task.priority === "medium"
        ? t("common.priorityMediumShort")
        : t("common.priorityLowShort");
  return (
    <div
      ref={cardRef}
      className={`gantt-hover-card${rotated ? " is-rotated" : ""}${
        pinned ? " is-pinned" : ""
      }`}
      style={{ left, top }}
      role="tooltip"
    >
      <strong>{task.title}</strong>
      {task.id !== parent.id && <p>{t("gantt.parent", { title: parent.title })}</p>}
      <p>
        {task.status === "done" ? t("common.done") : t("common.notDone")}
        {` · ${t("calendar.priority", { level: priority })}`}
        {category ? ` · ${category.name}` : ""}
      </p>
      {(task.start_at != null || task.due_at != null) && (
        <p>
          {task.start_at
            ? t("gantt.starts", { date: formatShortDate(task.start_at, locale) })
            : ""}
          {task.start_at && task.due_at ? " · " : ""}
          {task.due_at
            ? t("gantt.due", { date: formatShortDate(task.due_at, locale) })
            : ""}
        </p>
      )}
      <p>
        {t("gantt.clocks", {
          done: formatPomodoroAmount(task.completed_pomodoros ?? 0),
          estimate: task.estimate_pomodoros ?? 0,
        })}
      </p>
    </div>
  );
}

/** Clockwise 90° around the top-left corner swings the card left and down. */
function rotatedHoverPosition(
  x: number,
  y: number,
  layoutWidth: number,
  layoutHeight: number,
): { left: number; top: number } {
  const margin = 8;
  const visualWidth = layoutHeight;
  const visualHeight = layoutWidth;
  const visualLeft = Math.min(
    Math.max(margin, x + 12),
    Math.max(margin, window.innerWidth - visualWidth - margin),
  );
  const visualTop = Math.min(
    Math.max(margin, y + 12),
    Math.max(margin, window.innerHeight - visualHeight - margin),
  );
  return { left: visualLeft + layoutHeight, top: visualTop };
}

function uprightHoverPosition(x: number, y: number): { left: number; top: number } {
  return {
    left: Math.min(x + 14, window.innerWidth - 280),
    top: Math.min(y + 16, window.innerHeight - 180),
  };
}

function GanttTrackBg({
  columns,
  todayLeft,
}: {
  columns: GanttColumn[];
  todayLeft: number | null;
}) {
  return (
    <>
      {columns.map((col) => (
        <span
          key={col.key}
          className={`gantt-col${col.isWeekend ? " is-weekend" : ""}`}
        />
      ))}
      {todayLeft != null && (
        <span
          className="gantt-today-line"
          style={{ left: `${todayLeft}px` }}
          aria-hidden
        />
      )}
    </>
  );
}

function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const parsed = new Date(y, m - 1, d);
  if (
    parsed.getFullYear() !== y ||
    parsed.getMonth() !== m - 1 ||
    parsed.getDate() !== d
  ) {
    return null;
  }
  return startOfLocalDay(parsed);
}
