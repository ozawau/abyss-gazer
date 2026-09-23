import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Category,
  listCategories,
  listFirstCompletedFocusStarts,
  listPomodoroSessionsInRange,
  PomodoroSession,
  Task,
  TaskPriority,
} from "../lib/api";
import {
  addDays,
  addMonths,
  startOfLocalDay,
  type WeekStartsOn,
} from "../lib/calendar";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
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
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

const SCALE_TABS: { id: GanttScale; label: string }[] = [
  { id: "week", label: "双周" },
  { id: "month", label: "月" },
  { id: "quarter", label: "季" },
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
}: GanttViewProps) {
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [scale, setScale] = useState<GanttScale | null>("month");
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
  const [hover, setHover] = useState<{
    task: Task;
    parent: Task;
    x: number;
    y: number;
  } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [timelineWidth, setTimelineWidth] = useState(0);

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

  const baseRange = useMemo(() => {
    if (scale == null && customRange) {
      return buildGanttDayRange(customRange.start, customRange.end);
    }
    return buildGanttRange(scale ?? "month", cursor, weekStartsOn);
  }, [scale, cursor, weekStartsOn, customRange]);

  const range = useMemo(() => {
    const count = Math.max(baseRange.columns.length, 1);
    if (timelineWidth <= 0) return baseRange;
    return { ...baseRange, columnWidth: timelineWidth / count };
  }, [baseRange, timelineWidth]);

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
  }, []);

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
  }, [baseRange]);

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
      ganttContinuousBarLayout(task, range, firstFocusStarts, today) != null
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
    scale == null ? formatGanttSpan(range) : formatGanttTitle(scale, range, cursor);
  const emptyMessage = "当前时间范围内没有排期、专注或完成的任务。";

  useLayoutEffect(() => {
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
  }, [baseRange.columns.length]);

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
          <h1>甘特图</h1>
          <p>查看排期，以及时间范围内的专注与完成记录。</p>
        </div>
        <div className="calendar-toolbar">
          <div className="calendar-mode-tabs" role="tablist" aria-label="时间粒度">
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
                {tab.label}
              </button>
            ))}
          </div>
          <div className="calendar-nav">
            <button type="button" className="secondary-btn" onClick={goPrev}>
              上一段
            </button>
            <button type="button" className="secondary-btn" onClick={goToday}>
              今天
            </button>
            <button type="button" className="secondary-btn" onClick={goNext}>
              下一段
            </button>
          </div>
        </div>
      </header>

      <div className="calendar-filters gantt-filters">
        <div className="gantt-filters-main">
          <strong className="calendar-period-title">{title}</strong>
          <label className="calendar-jump-field">
            <span>开始</span>
            <input
              type="date"
              className="calendar-jump-input calendar-jump-input-date"
              value={toDateInput(range.start)}
              onChange={(e) => setRangeBound("start", e.target.value)}
            />
          </label>
          <label className="calendar-jump-field">
            <span>结束</span>
            <input
              type="date"
              className="calendar-jump-input calendar-jump-input-date"
              value={toDateInput(range.end)}
              onChange={(e) => setRangeBound("end", e.target.value)}
            />
          </label>
          <label className="calendar-filter-field">
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
          <label className="calendar-filter-check">
            <input
              type="checkbox"
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
            />
            隐藏已完成
          </label>
        </div>
        <div
          className="gantt-activity-switch"
          role="radiogroup"
          aria-label="任务活动显示模式"
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
              {mode === "discrete" ? "离散" : "连续"}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {visibleRows.length === 0 && (
        <p className="gantt-empty">{emptyMessage}</p>
      )}

      <div className="gantt-board" ref={boardRef}>
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
                  onHover={setHover}
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

      {hover && (
        <GanttTaskHover
          task={hover.task}
          parent={hover.parent}
          x={hover.x}
          y={hover.y}
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
  onHover: (
    next: { task: Task; parent: Task; x: number; y: number } | null,
  ) => void;
}) {
  const { parent, items } = row;
  const lanes = items.map((task) => {
    const continuousBar =
      activityMode === "continuous"
        ? ganttContinuousBarLayout(task, range, firstFocusStarts, today)
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
  const laneCount = Math.max(lanes.length, 1);
  const stacked = lanes.length > 1;
  const parentColor = ganttTaskColor(parent.id);
  const childCount = items.some((item) => item.id !== parent.id)
    ? items.length
    : 0;

  return (
    <div
      className={`gantt-row${stacked ? " is-stacked" : ""}`}
      style={{ minHeight: `${laneCount * 2.15}rem` }}
      onMouseLeave={() => onHover(null)}
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
          onClick={() => onSelectTask(parent.id)}
          title={parent.title}
          onMouseEnter={(e) =>
            onHover({ task: parent, parent, x: e.clientX, y: e.clientY })
          }
          onMouseMove={(e) =>
            onHover({ task: parent, parent, x: e.clientX, y: e.clientY })
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
            title="开始番茄钟"
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
          return (
            <div
              key={lane.task.id}
              className="gantt-lane"
              style={{
                top: `${index * 2.15}rem`,
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
                      ? `完成 ${mark.count} 个番茄`
                      : mark.kind === "done"
                        ? "完成"
                        : "专注"
                  }
                  onMouseEnter={(e) => {
                    onHover({
                      task: lane.task,
                      parent,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onMouseMove={(e) => {
                    onHover({
                      task: lane.task,
                      parent,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  {mark.count > 0 ? mark.count : ""}
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
                  }}
                  onMouseEnter={(e) => {
                    onHover({
                      task: lane.task,
                      parent,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onMouseMove={(e) => {
                    onHover({
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
  category,
}: {
  task: Task;
  parent: Task;
  x: number;
  y: number;
  category: Category | null;
}) {
  const left = Math.min(x + 14, window.innerWidth - 280);
  const top = Math.min(y + 16, window.innerHeight - 180);
  return (
    <div
      className="gantt-hover-card"
      style={{ left, top }}
      role="tooltip"
    >
      <strong>{task.title}</strong>
      {task.id !== parent.id && <p>父任务 {parent.title}</p>}
      <p>
        {task.status === "done" ? "已完成" : "未完成"}
        {` · 优先级 ${PRIORITY_LABEL[task.priority]}`}
        {category ? ` · ${category.name}` : ""}
      </p>
      {(task.start_at != null || task.due_at != null) && (
        <p>
          {task.start_at
            ? `开始 ${new Date(task.start_at).toLocaleDateString("zh-CN")}`
            : ""}
          {task.start_at && task.due_at ? " · " : ""}
          {task.due_at
            ? `到期 ${new Date(task.due_at).toLocaleDateString("zh-CN")}`
            : ""}
        </p>
      )}
      <p>
        番茄 {formatPomodoroAmount(task.completed_pomodoros ?? 0)}/{task.estimate_pomodoros ?? 0}
      </p>
    </div>
  );
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
