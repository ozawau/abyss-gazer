import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Category,
  listCategories,
  listPomodoroSessionsInRange,
  PomodoroSession,
  Task,
  TaskPriority,
} from "../lib/api";
import type { WeekStartsOn } from "../lib/api";
import {
  addMonths,
  addYears,
  buildMonthGrid,
  buildWeekDays,
  calendarRangeMs,
  CalendarMode,
  categoryColor,
  clipSessionToDay,
  completedTasksOnDay,
  countDayActivity,
  dayKey,
  focusSessionsOnDay,
  formatDayPanelTitle,
  formatMonthTitle,
  formatTimeHm,
  formatWeekTitle,
  formatYearTitle,
  MINUTES_PER_DAY,
  sameDay,
  scheduledTasksOnDay,
  startOfLocalDay,
  startOfWeek,
  taskCompletedOnDay,
  taskMarkerKind,
  weekdayShortLabels,
} from "../lib/calendar";
import { useCnHolidayRevision } from "../lib/cnHolidayData";
import {
  statutoryDayInfo,
  statutoryDayTitle,
} from "../lib/cnStatutoryDay";

interface CalendarViewProps {
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

function densityClass(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return " density-1";
  if (count <= 3) return " density-2";
  return " density-3";
}

export function CalendarView({
  tasks,
  selectedTaskId,
  onSelectTask,
  onStartPomodoro,
  weekStartsOn,
}: CalendarViewProps) {
  useCnHolidayRevision();
  const viewRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() =>
    startOfLocalDay(new Date()),
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [hideDone, setHideDone] = useState(false);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [error, setError] = useState<string | null>(null);

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
    const { startMs, endMs } = calendarRangeMs(mode, cursor, weekStartsOn);
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
  }, [mode, cursor, weekStartsOn]);

  useEffect(() => {
    const root = viewRef.current;
    if (!root) return;
    const scroller = root.closest("main");
    if (scroller) scroller.scrollTop = 0;
    else window.scrollTo(0, 0);
  }, [mode]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (hideDone && t.status === "done") return false;
      if (categoryFilter === "none") return !t.category_id;
      if (categoryFilter !== "all" && t.category_id !== categoryFilter) {
        return false;
      }
      return true;
    });
  }, [tasks, categoryFilter, hideDone]);

  const taskMap = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );

  const visibleTaskIds = useMemo(
    () => new Set(filteredTasks.map((task) => task.id)),
    [filteredTasks],
  );

  const scheduledTasks = useMemo(
    () =>
      filteredTasks.filter(
        (task) => task.start_at != null || task.due_at != null,
      ),
    [filteredTasks],
  );

  const visibleSessions = useMemo(
    () => sessions.filter((session) => visibleTaskIds.has(session.task_id)),
    [sessions, visibleTaskIds],
  );

  const selectedDayScheduled = useMemo(
    () => scheduledTasksOnDay(scheduledTasks, selectedDay),
    [scheduledTasks, selectedDay],
  );

  const selectedDayCompleted = useMemo(
    () => completedTasksOnDay(filteredTasks, selectedDay),
    [filteredTasks, selectedDay],
  );

  const selectedDayScheduledOnly = useMemo(() => {
    const doneIds = new Set(selectedDayCompleted.map((t) => t.id));
    return selectedDayScheduled.filter((t) => !doneIds.has(t.id));
  }, [selectedDayScheduled, selectedDayCompleted]);

  const selectedDaySessions = useMemo(
    () => focusSessionsOnDay(visibleSessions, selectedDay),
    [visibleSessions, selectedDay],
  );

  const title = useMemo(() => {
    if (mode === "year") return formatYearTitle(cursor);
    if (mode === "week") return formatWeekTitle(startOfWeek(cursor, weekStartsOn));
    return formatMonthTitle(cursor);
  }, [mode, cursor, weekStartsOn]);

  function goToday() {
    const now = startOfLocalDay(new Date());
    setCursor(now);
    setSelectedDay(now);
  }

  function goPrev() {
    if (mode === "year") setCursor((d) => addYears(d, -1));
    else if (mode === "week") setCursor((d) => addDaysSafe(d, -7));
    else setCursor((d) => addMonths(d, -1));
  }

  function goNext() {
    if (mode === "year") setCursor((d) => addYears(d, 1));
    else if (mode === "week") setCursor((d) => addDaysSafe(d, 7));
    else setCursor((d) => addMonths(d, 1));
  }

  function selectDay(day: Date, switchMode?: CalendarMode) {
    const next = startOfLocalDay(day);
    setSelectedDay(next);
    setCursor(next);
    if (switchMode) setMode(switchMode);
  }

  const weekdays = weekdayShortLabels(weekStartsOn);

  return (
    <div className="view calendar-view" ref={viewRef}>
      <header className="view-header calendar-header">
        <div className="calendar-header-main">
          <h1>日历</h1>
          <p>查看任务排期与实际完成的番茄专注。</p>
        </div>
        <div className="calendar-toolbar">
          <div className="calendar-mode-tabs" role="tablist" aria-label="视图">
            {(
              [
                ["year", "年"],
                ["month", "月"],
                ["week", "周"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={`calendar-mode-tab${mode === id ? " is-active" : ""}`}
                onClick={() => setMode(id)}
              >
                {label}
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
        <CalendarPeriodJump
          mode={mode}
          cursor={cursor}
          selectedDay={selectedDay}
          onJump={(day) => {
            const next = startOfLocalDay(day);
            setCursor(next);
            setSelectedDay(next);
          }}
        />
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

      <div
        className={`calendar-body${mode === "week" ? " is-week-mode" : ""}`}
      >
        <div className="calendar-main">
          {mode === "year" && (
            <YearGrid
              year={cursor.getFullYear()}
              today={today}
              selectedDay={selectedDay}
              tasks={filteredTasks}
              sessions={visibleSessions}
              weekStartsOn={weekStartsOn}
              onSelectDay={(day) => selectDay(day, "month")}
              onSelectMonth={(monthIndex) => {
                const next = startOfLocalDay(
                  new Date(cursor.getFullYear(), monthIndex, 1),
                );
                setCursor(next);
                setSelectedDay(next);
                setMode("month");
              }}
            />
          )}
          {mode === "month" && (
            <MonthGrid
              anchor={cursor}
              today={today}
              selectedDay={selectedDay}
              tasks={filteredTasks}
              sessions={visibleSessions}
              taskMap={taskMap}
              categoryMap={categoryMap}
              weekdays={weekdays}
              weekStartsOn={weekStartsOn}
              onSelectDay={(day) => selectDay(day)}
            />
          )}
          {mode === "week" && (
            <WeekGrid
              anchor={cursor}
              today={today}
              selectedDay={selectedDay}
              sessions={visibleSessions}
              taskMap={taskMap}
              categoryMap={categoryMap}
              weekdays={weekdays}
              weekStartsOn={weekStartsOn}
              onSelectDay={(day) => selectDay(day)}
              onSelectTask={onSelectTask}
              selectedTaskId={selectedTaskId}
            />
          )}
        </div>

        {mode !== "week" && (
        <aside className="calendar-day-panel" aria-label="当日任务">
          <header className="calendar-day-panel-header">
            <h2>{formatDayPanelTitle(selectedDay)}</h2>
            <p>
              排期 {selectedDayScheduledOnly.length} 项 · 完成{" "}
              {selectedDayCompleted.length} 项 · 完成番茄{" "}
              {selectedDaySessions.length} 个
            </p>
          </header>
          {selectedDayScheduledOnly.length === 0 &&
          selectedDayCompleted.length === 0 &&
          selectedDaySessions.length === 0 ? (
            <p className="calendar-day-empty">
              这一天没有排期、完成的任务或番茄。
            </p>
          ) : (
            <>
              {selectedDaySessions.length > 0 && (
                <DayFocusList
                  sessions={selectedDaySessions}
                  taskMap={taskMap}
                  selectedTaskId={selectedTaskId}
                  onSelectTask={onSelectTask}
                />
              )}
              {selectedDayCompleted.length > 0 && (
                <DayTaskSection
                  title="当天完成"
                  tasks={selectedDayCompleted}
                  selectedDay={selectedDay}
                  selectedTaskId={selectedTaskId}
                  categoryMap={categoryMap}
                  onSelectTask={onSelectTask}
                  onStartPomodoro={onStartPomodoro}
                  kind="completed"
                />
              )}
              {selectedDayScheduledOnly.length > 0 && (
                <DayTaskSection
                  title="排期任务"
                  tasks={selectedDayScheduledOnly}
                  selectedDay={selectedDay}
                  selectedTaskId={selectedTaskId}
                  categoryMap={categoryMap}
                  onSelectTask={onSelectTask}
                  onStartPomodoro={onStartPomodoro}
                  kind="scheduled"
                />
              )}
            </>
          )}
        </aside>
        )}
      </div>
    </div>
  );
}

function CalendarPeriodJump({
  mode,
  cursor,
  selectedDay,
  onJump,
}: {
  mode: CalendarMode;
  cursor: Date;
  selectedDay: Date;
  onJump: (day: Date) => void;
}) {
  const [yearText, setYearText] = useState(() => String(cursor.getFullYear()));
  const [monthText, setMonthText] = useState(() =>
    String(cursor.getMonth() + 1),
  );
  const [weekDateText, setWeekDateText] = useState(() => dayKey(selectedDay));

  useEffect(() => {
    setYearText(String(cursor.getFullYear()));
    setMonthText(String(cursor.getMonth() + 1));
  }, [cursor, mode]);

  useEffect(() => {
    setWeekDateText(dayKey(selectedDay));
  }, [selectedDay, mode]);

  function commitYear() {
    const y = Number.parseInt(yearText, 10);
    if (!Number.isFinite(y) || y < 1970 || y > 2100) {
      setYearText(String(cursor.getFullYear()));
      return;
    }
    onJump(new Date(y, mode === "month" ? cursor.getMonth() : 0, 1));
  }

  function commitMonthParts() {
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

  function commitWeekDate() {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekDateText.trim());
    if (!match) {
      setWeekDateText(dayKey(selectedDay));
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
      setWeekDateText(dayKey(selectedDay));
      return;
    }
    onJump(parsed);
  }

  if (mode === "year") {
    return (
      <label className="calendar-jump-field">
        <span>跳转</span>
        <input
          type="number"
          className="calendar-jump-input"
          min={1970}
          max={2100}
          value={yearText}
          onChange={(e) => setYearText(e.target.value)}
          onBlur={() => commitYear()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitYear();
          }}
        />
        <span className="calendar-jump-suffix">年</span>
      </label>
    );
  }

  if (mode === "month") {
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
          onBlur={() => commitMonthParts()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitMonthParts();
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
          onBlur={() => commitMonthParts()}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitMonthParts();
          }}
        />
        <span className="calendar-jump-suffix">月</span>
      </div>
    );
  }

  return (
    <label className="calendar-jump-field">
      <span>跳转</span>
      <input
        type="date"
        className="calendar-jump-input calendar-jump-input-date"
        value={weekDateText}
        onChange={(e) => setWeekDateText(e.target.value)}
        onBlur={() => commitWeekDate()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitWeekDate();
        }}
      />
    </label>
  );
}

function addDaysSafe(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return startOfLocalDay(d);
}

function YearGrid({
  year,
  today,
  selectedDay,
  tasks,
  sessions,
  weekStartsOn,
  onSelectDay,
  onSelectMonth,
}: {
  year: number;
  today: Date;
  selectedDay: Date;
  tasks: Task[];
  sessions: PomodoroSession[];
  weekStartsOn: WeekStartsOn;
  onSelectDay: (day: Date) => void;
  onSelectMonth: (monthIndex: number) => void;
}) {
  const weekdays = weekdayShortLabels(weekStartsOn);
  return (
    <div className="calendar-year-grid">
      {Array.from({ length: 12 }, (_, monthIndex) => {
        const anchor = new Date(year, monthIndex, 1);
        const cells = buildMonthGrid(anchor, weekStartsOn);
        return (
          <section key={monthIndex} className="calendar-year-month">
            <button
              type="button"
              className="calendar-year-month-title"
              onClick={() => onSelectMonth(monthIndex)}
            >
              {monthIndex + 1}月
            </button>
            <div className="calendar-year-weekdays">
              {weekdays.map((w) => (
                <span
                  key={w}
                  className={w === "六" || w === "日" ? "is-weekend" : undefined}
                >
                  {w}
                </span>
              ))}
            </div>
            <div className="calendar-year-days">
              {cells.map((day) => {
                const inMonth = day.getMonth() === monthIndex;
                if (!inMonth) {
                  return <span key={dayKey(day)} className="calendar-year-day is-outside" />;
                }
                const count = countDayActivity(tasks, sessions, day);
                const statutory = statutoryDayInfo(day);
                const weekend = day.getDay() === 0 || day.getDay() === 6;
                const titleParts: string[] = [];
                if (statutory) titleParts.push(statutoryDayTitle(statutory));
                if (count > 0) titleParts.push(`${count} 项任务`);
                return (
                  <button
                    key={dayKey(day)}
                    type="button"
                    className={`calendar-year-day${
                      sameDay(day, today) ? " is-today" : ""
                    }${sameDay(day, selectedDay) ? " is-selected" : ""}${densityClass(count)}${
                      statutory?.mark === "holiday"
                        ? " has-statutory-holiday"
                        : statutory?.mark === "adjusted-workday"
                          ? " has-statutory-workday"
                          : ""
                    }${weekend ? " is-weekend" : ""}`}
                    onClick={() => onSelectDay(day)}
                    title={
                      titleParts.length > 0 ? titleParts.join(" · ") : undefined
                    }
                  >
                    <span className="calendar-year-daynum">{day.getDate()}</span>
                    {statutory && (
                      <span
                        className={`calendar-year-statutory is-${statutory.mark}`}
                        aria-hidden
                      >
                        {statutory.mark === "holiday" ? "休" : "班"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({
  anchor,
  today,
  selectedDay,
  tasks,
  sessions,
  taskMap,
  categoryMap,
  weekdays,
  weekStartsOn,
  onSelectDay,
}: {
  anchor: Date;
  today: Date;
  selectedDay: Date;
  tasks: Task[];
  sessions: PomodoroSession[];
  taskMap: Map<string, Task>;
  categoryMap: Map<string, Category>;
  weekdays: string[];
  weekStartsOn: WeekStartsOn;
  onSelectDay: (day: Date) => void;
}) {
  const cells = useMemo(
    () => buildMonthGrid(anchor, weekStartsOn),
    [anchor, weekStartsOn],
  );
  const month = anchor.getMonth();

  return (
    <div className="calendar-month">
      <div className="calendar-month-weekdays">
        {weekdays.map((w) => (
          <span
            key={w}
            className={w === "六" || w === "日" ? "is-weekend" : undefined}
          >
            周{w}
          </span>
        ))}
      </div>
      <div className="calendar-month-grid">
        {cells.map((day) => {
          const inMonth = day.getMonth() === month;
          const dayTasks = inMonth
            ? [
                ...completedTasksOnDay(tasks, day),
                ...scheduledTasksOnDay(tasks, day).filter(
                  (task) => !taskCompletedOnDay(task, day),
                ),
              ]
            : [];
          const daySessions = inMonth ? focusSessionsOnDay(sessions, day) : [];
          const statutory = statutoryDayInfo(day);
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          const events: Array<
            | { type: "session"; session: PomodoroSession; task: Task }
            | { type: "task"; task: Task }
          > = [
            ...daySessions.flatMap((session) => {
              const task = taskMap.get(session.task_id);
              return task ? [{ type: "session" as const, session, task }] : [];
            }),
            ...dayTasks.map((task) => ({ type: "task" as const, task })),
          ];
          return (
            <button
              key={dayKey(day)}
              type="button"
              className={`calendar-month-cell${
                inMonth ? "" : " is-outside"
              }${sameDay(day, today) ? " is-today" : ""}${
                sameDay(day, selectedDay) ? " is-selected" : ""
              }${
                statutory?.mark === "holiday"
                  ? " has-statutory-holiday"
                  : statutory?.mark === "adjusted-workday"
                    ? " has-statutory-workday"
                    : ""
              }${weekend ? " is-weekend" : ""}`}
              onClick={() => onSelectDay(day)}
            >
              <span className="calendar-month-dayhead">
                <span className="calendar-month-daynum">{day.getDate()}</span>
                {statutory && (
                  <span
                    className={`calendar-month-statutory is-${statutory.mark}`}
                    aria-hidden
                  >
                    {statutory.mark === "holiday" ? "休" : "班"}
                  </span>
                )}
              </span>
              <ul className="calendar-month-events">
                {events.slice(0, 3).map((event) => {
                  const task = event.task;
                  const category = task.category_id
                    ? categoryMap.get(task.category_id)
                    : null;
                  const marker =
                    event.type === "session"
                      ? "focus"
                      : taskCompletedOnDay(task, day)
                        ? "done"
                        : taskMarkerKind(task, day);
                  return (
                    <li
                      key={
                        event.type === "session"
                          ? event.session.id
                          : `task-${task.id}`
                      }
                      className={`calendar-month-event${
                        task.status === "done" ? " is-done" : ""
                      }`}
                      style={
                        category
                          ? { borderLeftColor: category.color }
                          : undefined
                      }
                    >
                      <span className="calendar-event-marker">
                        {marker === "focus"
                          ? "专"
                          : marker === "done"
                            ? "完"
                            : marker === "start"
                              ? "始"
                              : marker === "due"
                                ? "止"
                                : "·"}
                      </span>
                      {task.title}
                    </li>
                  );
                })}
                {events.length > 3 && (
                  <li className="calendar-month-more">
                    +{events.length - 3}
                  </li>
                )}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  anchor,
  today,
  selectedDay,
  sessions,
  taskMap,
  categoryMap,
  weekdays,
  weekStartsOn,
  onSelectDay,
  onSelectTask,
  selectedTaskId,
}: {
  anchor: Date;
  today: Date;
  selectedDay: Date;
  sessions: PomodoroSession[];
  taskMap: Map<string, Task>;
  categoryMap: Map<string, Category>;
  weekdays: string[];
  weekStartsOn: WeekStartsOn;
  onSelectDay: (day: Date) => void;
  onSelectTask: (id: string | null) => void;
  selectedTaskId: string | null;
}) {
  const days = useMemo(
    () => buildWeekDays(anchor, weekStartsOn),
    [anchor, weekStartsOn],
  );

  return (
    <div className="calendar-week-matrix" aria-label="周视图">
      <div className="calendar-week-matrix-corner" aria-hidden />
      <div className="calendar-week-matrix-hours" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => {
          const hour = i * 2;
          return (
            <span key={hour} className="calendar-week-matrix-hour-cell">
              <span className="calendar-week-matrix-hour-tick">
                {String(hour).padStart(2, "0")}:00
              </span>
              {hour === 22 && (
                <span className="calendar-week-matrix-hour-tick is-end">
                  24:00
                </span>
              )}
            </span>
          );
        })}
      </div>
      {days.map((day, index) => (
        <Fragment key={dayKey(day)}>
          <button
            type="button"
            className={`calendar-week-matrix-day${
              sameDay(day, today) ? " is-today" : ""
            }${sameDay(day, selectedDay) ? " is-selected" : ""}`}
            onClick={() => onSelectDay(day)}
          >
            <span>周{weekdays[index]}</span>
            <strong>
              {day.getMonth() + 1}/{day.getDate()}
            </strong>
          </button>
          <div
            className={`calendar-week-matrix-track${
              sameDay(day, today) ? " is-today" : ""
            }${sameDay(day, selectedDay) ? " is-selected" : ""}`}
            onClick={() => onSelectDay(day)}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="calendar-week-matrix-slot" />
            ))}
            {focusSessionsOnDay(sessions, day).map((session) => {
              const task = taskMap.get(session.task_id);
              const clipped = clipSessionToDay(session, day);
              if (!task || !clipped) return null;
              const leftPct = (clipped.startMin / MINUTES_PER_DAY) * 100;
              const widthPct =
                ((clipped.endMin - clipped.startMin) / MINUTES_PER_DAY) * 100;
              const color = categoryColor(task.category_id, categoryMap);
              const tip = `${formatTimeHm(session.started_at)}–${formatTimeHm(
                session.ended_at,
              )} ${task.title}`;
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`calendar-week-color-block${
                    selectedTaskId === task.id ? " is-selected" : ""
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${Math.max(widthPct, 0.35)}%`,
                    backgroundColor: color,
                  }}
                  title={tip}
                  aria-label={tip}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectDay(day);
                    onSelectTask(task.id);
                  }}
                />
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function DayTaskSection({
  title,
  tasks,
  selectedDay,
  selectedTaskId,
  categoryMap,
  onSelectTask,
  onStartPomodoro,
  kind,
}: {
  title: string;
  tasks: Task[];
  selectedDay: Date;
  selectedTaskId: string | null;
  categoryMap: Map<string, Category>;
  onSelectTask: (id: string | null) => void;
  onStartPomodoro: (taskId: string) => void;
  kind: "completed" | "scheduled";
}) {
  return (
    <>
      <h3 className="calendar-day-section-title">{title}</h3>
      <ul className="calendar-day-list">
        {tasks.map((task) => {
          const category = task.category_id
            ? categoryMap.get(task.category_id)
            : null;
          const marker =
            kind === "completed" ? "done" : taskMarkerKind(task, selectedDay);
          return (
            <li
              key={task.id}
              className={`calendar-day-item${
                selectedTaskId === task.id ? " is-selected" : ""
              }${task.status === "done" ? " is-done" : ""}`}
            >
              <button
                type="button"
                className="calendar-day-item-main"
                onClick={() => onSelectTask(task.id)}
              >
                <strong>{task.title}</strong>
                <span className="calendar-day-item-meta">
                  {marker === "done" && <em>完成</em>}
                  {marker === "start" && <em>开始</em>}
                  {marker === "due" && <em>到期</em>}
                  {marker === "span" && <em>进行中</em>}
                  <span>优先级 {PRIORITY_LABEL[task.priority]}</span>
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
                </span>
              </button>
              {task.status !== "done" && (
                <button
                  type="button"
                  className="ghost-btn"
                  title="开始番茄钟"
                  onClick={() => onStartPomodoro(task.id)}
                >
                  ▶
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function DayFocusList({
  sessions,
  taskMap,
  selectedTaskId,
  onSelectTask,
}: {
  sessions: PomodoroSession[];
  taskMap: Map<string, Task>;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
}) {
  return (
    <>
      <h3 className="calendar-day-section-title">实际专注</h3>
      <ul className="calendar-day-list">
        {sessions.map((session) => {
          const task = taskMap.get(session.task_id);
          if (!task) return null;
          return (
            <li
              key={session.id}
              className={`calendar-day-item is-focus${
                selectedTaskId === task.id ? " is-selected" : ""
              }`}
            >
              <button
                type="button"
                className="calendar-day-item-main"
                onClick={() => onSelectTask(task.id)}
              >
                <strong>{task.title}</strong>
                <span className="calendar-day-item-meta">
                  <em>已专注</em>
                  <span>
                    {formatTimeHm(session.started_at)}–
                    {formatTimeHm(session.ended_at)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
