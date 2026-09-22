import { useEffect, useMemo, useRef, useState } from "react";
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
  addMonths,
  startOfLocalDay,
  type WeekStartsOn,
} from "../lib/calendar";
import {
  buildGanttRange,
  formatGanttTitle,
  ganttActivityMarks,
  ganttBarLayout,
  ganttContinuousBarLayout,
  ganttColumnIsToday,
  ganttParentRows,
  ganttRangeQueryMs,
  ganttTaskColor,
  sortGanttParentRows,
  startOfQuarter,
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
}: GanttViewProps) {
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [scale, setScale] = useState<GanttScale>("month");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
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
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const range = useMemo(
    () => buildGanttRange(scale, cursor, weekStartsOn),
    [scale, cursor, weekStartsOn],
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const { startMs, endMs } = ganttRangeQueryMs(range);
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
  }, [range]);

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

  const timelineWidth = range.columns.length * range.columnWidth;
  const title = formatGanttTitle(scale, range, cursor);
  const emptyMessage = "当前时间范围内没有排期、专注或完成的任务。";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (todayLeft == null) {
      el.scrollLeft = 0;
      return;
    }
    el.scrollLeft = Math.max(0, todayLeft - el.clientWidth * 0.28);
  }, [todayLeft, scale, range.start]);

  function goToday() {
    setCursor(startOfLocalDay(new Date()));
  }

  function goPrev() {
    if (scale === "week") setCursor((d) => addDaysSafe(d, -14));
    else if (scale === "quarter") setCursor((d) => addMonths(d, -3));
    else setCursor((d) => addMonths(d, -1));
  }

  function goNext() {
    if (scale === "week") setCursor((d) => addDaysSafe(d, 14));
    else if (scale === "quarter") setCursor((d) => addMonths(d, 3));
    else setCursor((d) => addMonths(d, 1));
  }

  function jumpTo(day: Date) {
    setCursor(startOfLocalDay(day));
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
                onClick={() => setScale(tab.id)}
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
          <GanttJump scale={scale} cursor={cursor} onJump={jumpTo} />
          <label className="calendar-filter-field">
            <span>分类</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
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

      <div className="gantt-board">
        <div className="gantt-scroll" ref={scrollRef}>
          <div
            className="gantt-grid"
            style={{
              width: `calc(var(--gantt-name-col) + ${timelineWidth}px)`,
            }}
          >
            <div className="gantt-header-row">
              <div className="gantt-corner" />
              <div
                className="gantt-head"
                style={{ width: `${timelineWidth}px` }}
              >
                {range.columns.map((col) => (
                  <div
                    key={col.key}
                    className={`gantt-head-cell${col.isWeekend ? " is-weekend" : ""}${
                      ganttColumnIsToday(col, today, range.unitDays)
                        ? " is-today"
                        : ""
                    }`}
                    style={{ width: range.columnWidth }}
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
                  timelineWidth={timelineWidth}
                  todayLeft={todayLeft}
                  onSelectTask={onSelectTask}
                  onStartPomodoro={onStartPomodoro}
                  onHover={setHover}
                />
              ))}
              {visibleRows.length === 0 && (
                <div className="gantt-row gantt-row-fill">
                  <div className="gantt-name-cell" />
                  <div
                    className="gantt-track"
                    style={{ width: `${timelineWidth}px` }}
                  >
                    <GanttTrackBg
                      columns={range.columns}
                      columnWidth={range.columnWidth}
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
  timelineWidth,
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
  timelineWidth: number;
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
        style={{
          width: `${timelineWidth}px`,
          minHeight: `${laneCount * 2.15}rem`,
        }}
        onClick={() => onSelectTask(parent.id)}
      >
        <GanttTrackBg
          columns={range.columns}
          columnWidth={range.columnWidth}
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
        番茄 {task.completed_pomodoros ?? 0}/{task.estimate_pomodoros ?? 0}
      </p>
    </div>
  );
}

function GanttTrackBg({
  columns,
  columnWidth,
  todayLeft,
}: {
  columns: GanttColumn[];
  columnWidth: number;
  todayLeft: number | null;
}) {
  return (
    <>
      {columns.map((col) => (
        <span
          key={col.key}
          className={`gantt-col${col.isWeekend ? " is-weekend" : ""}`}
          style={{ width: columnWidth }}
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

function addDaysSafe(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return startOfLocalDay(d);
}

function GanttJump({
  scale,
  cursor,
  onJump,
}: {
  scale: GanttScale;
  cursor: Date;
  onJump: (day: Date) => void;
}) {
  const [yearText, setYearText] = useState(() => String(cursor.getFullYear()));
  const [monthText, setMonthText] = useState(() =>
    String(cursor.getMonth() + 1),
  );
  const [dateText, setDateText] = useState(() => toDateInput(cursor));
  const [quarter, setQuarter] = useState(
    () => Math.floor(cursor.getMonth() / 3) + 1,
  );

  useEffect(() => {
    setYearText(String(cursor.getFullYear()));
    setMonthText(String(cursor.getMonth() + 1));
    setDateText(toDateInput(cursor));
    setQuarter(Math.floor(cursor.getMonth() / 3) + 1);
  }, [cursor, scale]);

  function commitMonth() {
    const y = Number.parseInt(yearText, 10);
    const m = Number.parseInt(monthText, 10);
    if (
      !Number.isFinite(y) ||
      y < 1970 ||
      y > 2100 ||
      !Number.isFinite(m) ||
      m < 1 ||
      m > 12
    ) {
      setYearText(String(cursor.getFullYear()));
      setMonthText(String(cursor.getMonth() + 1));
      return;
    }
    onJump(new Date(y, m - 1, 1));
  }

  function commitQuarter() {
    const y = Number.parseInt(yearText, 10);
    if (!Number.isFinite(y) || y < 1970 || y > 2100) {
      setYearText(String(cursor.getFullYear()));
      return;
    }
    onJump(startOfQuarter(new Date(y, (quarter - 1) * 3, 1)));
  }

  function commitDate() {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText.trim());
    if (!match) {
      setDateText(toDateInput(cursor));
      return;
    }
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const parsed = new Date(y, m - 1, d);
    if (
      parsed.getFullYear() !== y ||
      parsed.getMonth() !== m - 1 ||
      parsed.getDate() !== d
    ) {
      setDateText(toDateInput(cursor));
      return;
    }
    onJump(parsed);
  }

  if (scale === "week") {
    return (
      <label className="calendar-jump-field">
        <span>跳转</span>
        <input
          type="date"
          className="calendar-jump-input calendar-jump-input-date"
          value={dateText}
          onChange={(e) => setDateText(e.target.value)}
          onBlur={() => commitDate()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDate();
          }}
        />
      </label>
    );
  }

  if (scale === "quarter") {
    return (
      <div className="calendar-jump-field calendar-jump-field-row">
        <span>跳转</span>
        <input
          type="number"
          className="calendar-jump-input calendar-jump-input-year"
          min={1970}
          max={2100}
          value={yearText}
          onChange={(e) => setYearText(e.target.value)}
          onBlur={() => commitQuarter()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitQuarter();
          }}
        />
        <span className="calendar-jump-suffix">年</span>
        <select
          className="settings-select"
          value={quarter}
          onChange={(e) => {
            const q = Number(e.target.value);
            setQuarter(q);
            const y = Number.parseInt(yearText, 10);
            if (Number.isFinite(y)) onJump(new Date(y, (q - 1) * 3, 1));
          }}
        >
          <option value={1}>第1季度</option>
          <option value={2}>第2季度</option>
          <option value={3}>第3季度</option>
          <option value={4}>第4季度</option>
        </select>
      </div>
    );
  }

  return (
    <div className="calendar-jump-field calendar-jump-field-row">
      <span>跳转</span>
      <input
        type="number"
        className="calendar-jump-input calendar-jump-input-year"
        min={1970}
        max={2100}
        value={yearText}
        onChange={(e) => setYearText(e.target.value)}
        onBlur={() => commitMonth()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitMonth();
        }}
      />
      <span className="calendar-jump-suffix">年</span>
      <input
        type="number"
        className="calendar-jump-input calendar-jump-input-month"
        min={1}
        max={12}
        value={monthText}
        onChange={(e) => setMonthText(e.target.value)}
        onBlur={() => commitMonth()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitMonth();
        }}
      />
      <span className="calendar-jump-suffix">月</span>
    </div>
  );
}

function toDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
