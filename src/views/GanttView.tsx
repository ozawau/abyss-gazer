import { useEffect, useMemo, useRef, useState } from "react";
import {
  Category,
  listCategories,
  listPomodoroSessionsInRange,
  PomodoroSession,
  Task,
  TaskPriority,
} from "../lib/api";
import {
  addMonths,
  categoryColor,
  startOfLocalDay,
  type WeekStartsOn,
} from "../lib/calendar";
import {
  buildGanttRange,
  formatGanttTitle,
  ganttActivityMarks,
  ganttBarLayout,
  ganttColumnIsToday,
  ganttRangeQueryMs,
  sortGanttTasks,
  startOfQuarter,
  taskVisibleOnGantt,
  todayOffsetPx,
  type GanttColumn,
  type GanttScale,
} from "../lib/gantt";

interface GanttViewProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onStartPomodoro: (taskId: string) => void;
  weekStartsOn: WeekStartsOn;
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
}: GanttViewProps) {
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [scale, setScale] = useState<GanttScale>("month");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [hideDone, setHideDone] = useState(false);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [error, setError] = useState<string | null>(null);
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

  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (hideDone && t.status === "done") return false;
      if (categoryFilter === "none") return !t.category_id;
      if (categoryFilter !== "all" && t.category_id !== categoryFilter) {
        return false;
      }
      return taskVisibleOnGantt(t, range, sessionTaskIds);
    });
    return sortGanttTasks(filtered, sessions);
  }, [tasks, hideDone, categoryFilter, range, sessionTaskIds, sessions]);

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

      <div className="calendar-filters">
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

      {error && <p className="error-banner">{error}</p>}

      {visibleTasks.length === 0 && (
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

              {visibleTasks.map((task) => {
                const bar = ganttBarLayout(task, range);
                const marks = ganttActivityMarks(task, sessions, range);
                const category = task.category_id
                  ? categoryMap.get(task.category_id)
                  : null;
                const color = categoryColor(task.category_id, categoryMap);
                return (
                  <div key={task.id} className="gantt-row">
                    <div
                      className={`gantt-name-cell${
                        selectedTaskId === task.id ? " is-selected" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className={`gantt-name${
                          task.status === "done" ? " is-done" : ""
                        }`}
                        onClick={() => onSelectTask(task.id)}
                        title={task.title}
                      >
                        <span
                          className="gantt-name-swatch"
                          style={{ background: color }}
                          aria-hidden
                        />
                        <span className="gantt-name-text">{task.title}</span>
                      </button>
                      {task.status !== "done" && (
                        <button
                          type="button"
                          className="gantt-name-play"
                          title="开始番茄钟"
                          onClick={() => onStartPomodoro(task.id)}
                        >
                          ▶
                        </button>
                      )}
                    </div>
                    <div
                      className="gantt-track"
                      style={{ width: `${timelineWidth}px` }}
                      onClick={() => onSelectTask(task.id)}
                    >
                      <GanttTrackBg
                        columns={range.columns}
                        columnWidth={range.columnWidth}
                        todayLeft={todayLeft}
                      />
                      {marks.map((mark) => (
                        <span
                          key={mark.key}
                          className={`gantt-mark is-${mark.kind}${
                            bar ? "" : " is-solo"
                          }`}
                          style={{
                            left: `${mark.left}px`,
                            width: `${mark.width}px`,
                            backgroundColor: color,
                          }}
                          title={mark.kind === "done" ? "完成" : "专注"}
                        />
                      ))}
                      {bar && (
                        <button
                          type="button"
                          className={`gantt-bar${
                            selectedTaskId === task.id ? " is-selected" : ""
                          }${task.status === "done" ? " is-done" : ""}${
                            bar.clippedStart ? " is-clip-start" : ""
                          }${bar.clippedEnd ? " is-clip-end" : ""}`}
                          style={{
                            left: `${bar.left}px`,
                            width: `${bar.width}px`,
                            backgroundColor: color,
                          }}
                          title={`${task.title} · 优先级 ${PRIORITY_LABEL[task.priority]}${
                            category ? ` · ${category.name}` : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectTask(task.id);
                          }}
                        >
                          <span className="gantt-bar-label">{task.title}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleTasks.length === 0 && (
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
