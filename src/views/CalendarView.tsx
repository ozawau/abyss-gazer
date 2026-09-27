import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../components/LocaleProvider";
import {
  Category,
  listCategories,
  listPomodoroSessionsInRange,
  PomodoroSession,
  Task,
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
  completedFocusCountOnDay,
  countDayActivity,
  dayKey,
  focusSessionsOnDay,
  formatDayPanelTitle,
  formatMonthName,
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
import { formatLunarDayShort } from "../lib/dateDisplay";
import { formatTaskLineage, leafTasks } from "../lib/taskTree";
import { useNarrowViewport } from "../lib/viewport";

interface CalendarViewProps {
  tasks: Task[];
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onStartPomodoro: (taskId: string) => void;
  weekStartsOn: WeekStartsOn;
  categoryFilter: string;
  onCategoryFilterChange: (filter: string) => void;
  dataEpoch: number;
}

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
  categoryFilter,
  onCategoryFilterChange,
  dataEpoch,
}: CalendarViewProps) {
  const { locale, t } = useI18n();
  useCnHolidayRevision();
  const viewRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const narrow = useNarrowViewport();
  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() =>
    startOfLocalDay(new Date()),
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [hideDone, setHideDone] = useState(false);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (narrow && mode === "year") setMode("month");
  }, [narrow, mode]);

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
  }, [mode, cursor, weekStartsOn, dataEpoch]);

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
    const leaves = new Set(leafTasks(tasks).map((task) => task.id));
    return tasks.filter((t) => {
      if (!leaves.has(t.id)) return false;
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
    if (mode === "year") return formatYearTitle(cursor, locale);
    if (mode === "week") return formatWeekTitle(startOfWeek(cursor, weekStartsOn), locale);
    return formatMonthTitle(cursor, locale);
  }, [mode, cursor, weekStartsOn, locale]);

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

  const weekdays = weekdayShortLabels(weekStartsOn, locale);

  return (
    <div className="view calendar-view" ref={viewRef}>
      <header className="view-header calendar-header">
        <div className="calendar-header-main">
          <h1>{t("calendar.title")}</h1>
          <p>{t("calendar.hint")}</p>
        </div>
        <div className="calendar-toolbar">
          <div className="calendar-mode-tabs" role="tablist" aria-label={t("calendar.view")}>
            {(
              [
                ["year", t("calendar.year")],
                ["month", t("calendar.month")],
                ["week", t("calendar.week")],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={`calendar-mode-tab${id === "year" ? " calendar-mode-year" : ""}${
                  mode === id ? " is-active" : ""
                }`}
                onClick={() => setMode(id)}
              >
                {label}
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
        <aside className="calendar-day-panel" aria-label={t("calendar.dayPanel")}>
          <header className="calendar-day-panel-header">
            <h2>{formatDayPanelTitle(selectedDay, locale)}</h2>
            <p>
              {t("calendar.summary", {
                scheduled: selectedDayScheduledOnly.length,
                done: selectedDayCompleted.length,
                pomodoros: selectedDaySessions.length,
              })}
            </p>
          </header>
          {selectedDayScheduledOnly.length === 0 &&
          selectedDayCompleted.length === 0 &&
          selectedDaySessions.length === 0 ? (
            <p className="calendar-day-empty">
              {t("calendar.empty")}
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
                  title={t("calendar.completedThatDay")}
                  tasks={selectedDayCompleted}
                  selectedDay={selectedDay}
                  selectedTaskId={selectedTaskId}
                  taskMap={taskMap}
                  categoryMap={categoryMap}
                  onSelectTask={onSelectTask}
                  onStartPomodoro={onStartPomodoro}
                  kind="completed"
                />
              )}
              {selectedDayScheduledOnly.length > 0 && (
                <DayTaskSection
                  title={t("calendar.scheduled")}
                  tasks={selectedDayScheduledOnly}
                  selectedDay={selectedDay}
                  selectedTaskId={selectedTaskId}
                  taskMap={taskMap}
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
  const { t } = useI18n();
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
        <span>{t("calendar.jump")}</span>
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
        <span className="calendar-jump-suffix">{t("calendar.yearSuffix")}</span>
      </label>
    );
  }

  if (mode === "month") {
    return (
      <div className="calendar-jump-field calendar-jump-field-row">
        <span>{t("calendar.jump")}</span>
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
        <span className="calendar-jump-suffix">{t("calendar.yearSuffix")}</span>
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
        <span className="calendar-jump-suffix">{t("calendar.monthSuffix")}</span>
      </div>
    );
  }

  return (
    <label className="calendar-jump-field">
      <span>{t("calendar.jump")}</span>
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
  const { locale, t } = useI18n();
  const weekdays = weekdayShortLabels(weekStartsOn, locale);
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
              {formatMonthName(monthIndex, locale)}
            </button>
            <div className="calendar-year-weekdays">
              {weekdays.map((w) => (
                <span
                  key={w}
                  className={(weekStartsOn + weekdays.indexOf(w)) % 7 === 0 || (weekStartsOn + weekdays.indexOf(w)) % 7 === 6 ? "is-weekend" : undefined}
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
                const lunar = formatLunarDayShort(day, locale);
                const titleParts: string[] = [];
                if (lunar) titleParts.push(t("calendar.lunar", { text: lunar }));
                if (statutory) titleParts.push(statutoryDayTitle(statutory, locale));
                if (count > 0) titleParts.push(t("calendar.taskCount", { count }));
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
                    {lunar && (
                      <span className="calendar-year-lunar">{lunar}</span>
                    )}
                    {statutory && (
                      <span
                        className={`calendar-year-statutory is-${statutory.mark}`}
                        aria-hidden
                      >
                        {statutory.mark === "holiday" ? t("calendar.rest") : t("calendar.work")}
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
  const { locale, t } = useI18n();
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
            className={(weekStartsOn + weekdays.indexOf(w)) % 7 === 0 || (weekStartsOn + weekdays.indexOf(w)) % 7 === 6 ? "is-weekend" : undefined}
          >
            {t("calendar.weekdayPrefix", { day: w })}
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
          const pomodoroCount = inMonth
            ? completedFocusCountOnDay(sessions, day)
            : 0;
          const statutory = statutoryDayInfo(day);
          const lunar = formatLunarDayShort(day, locale);
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          const events = new Map<
            string,
            { task: Task; focus: boolean; done: boolean }
          >();
          for (const session of daySessions) {
            const task = taskMap.get(session.task_id);
            if (!task) continue;
            const prev = events.get(task.id);
            if (prev) prev.focus = true;
            else {
              events.set(task.id, {
                task,
                focus: true,
                done: taskCompletedOnDay(task, day),
              });
            }
          }
          for (const task of dayTasks) {
            const prev = events.get(task.id);
            const done = taskCompletedOnDay(task, day);
            if (prev) prev.done = prev.done || done;
            else events.set(task.id, { task, focus: false, done });
          }
          const dayEvents = [...events.values()];
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
                <span className="calendar-month-daynums">
                  <span className="calendar-month-daynum">{day.getDate()}</span>
                  {lunar && <span className="calendar-month-lunar">{lunar}</span>}
                </span>
                <span className="calendar-month-daymeta">
                  {pomodoroCount > 0 && (
                    <span
                      className="calendar-month-pomos"
                      title={t("calendar.pomodorosDone", { count: pomodoroCount })}
                    >
                      {pomodoroCount}
                    </span>
                  )}
                  {statutory && (
                    <span
                      className={`calendar-month-statutory is-${statutory.mark}`}
                      aria-hidden
                    >
                      {statutory.mark === "holiday" ? t("calendar.rest") : t("calendar.work")}
                    </span>
                  )}
                </span>
              </span>
              <ul className="calendar-month-events">
                {dayEvents.slice(0, 3).map((event) => {
                  const task = event.task;
                  const category = task.category_id
                    ? categoryMap.get(task.category_id)
                    : null;
                  const tone =
                    event.focus && event.done
                      ? "is-both"
                      : event.done
                        ? "is-complete"
                        : event.focus
                          ? "is-focus"
                          : "";
                  const toneTitle =
                    event.focus && event.done
                      ? t("calendar.doneAndFocused")
                      : event.done
                        ? t("calendar.completed")
                        : event.focus
                          ? t("calendar.focused")
                          : undefined;
                  return (
                    <li
                      key={task.id}
                      className={`calendar-month-event${tone ? ` ${tone}` : ""}`}
                      title={toneTitle}
                      style={
                        category
                          ? { borderLeftColor: category.color }
                          : undefined
                      }
                    >
                      {task.title}
                    </li>
                  );
                })}
                {dayEvents.length > 3 && (
                  <li className="calendar-month-more">
                    +{dayEvents.length - 3}
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
  const { t } = useI18n();
  const days = useMemo(
    () => buildWeekDays(anchor, weekStartsOn),
    [anchor, weekStartsOn],
  );

  return (
    <div className="calendar-week-matrix" aria-label={t("calendar.weekView")}>
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
            <span>{t("calendar.weekdayPrefix", { day: weekdays[index] })}</span>
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
  taskMap,
  categoryMap,
  onSelectTask,
  onStartPomodoro,
  kind,
}: {
  title: string;
  tasks: Task[];
  selectedDay: Date;
  selectedTaskId: string | null;
  taskMap: Map<string, Task>;
  categoryMap: Map<string, Category>;
  onSelectTask: (id: string | null) => void;
  onStartPomodoro: (taskId: string) => void;
  kind: "completed" | "scheduled";
}) {
  const { t } = useI18n();
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
                <strong>{formatTaskLineage(task, taskMap)}</strong>
                <span className="calendar-day-item-meta">
                  {marker === "done" && <em>{t("calendar.finishedMark")}</em>}
                  {marker === "start" && <em>{t("calendar.startMark")}</em>}
                  {marker === "due" && <em>{t("calendar.dueMark")}</em>}
                  {marker === "span" && <em>{t("calendar.spanMark")}</em>}
                  <span>{t("calendar.priority", { level: t(task.priority === "high" ? "common.priorityHighShort" : task.priority === "medium" ? "common.priorityMediumShort" : "common.priorityLowShort") })}</span>
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
                  title={t("common.startPomodoro")}
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
  const { t } = useI18n();
  return (
    <>
      <h3 className="calendar-day-section-title">{t("calendar.actualFocus")}</h3>
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
                <strong>{formatTaskLineage(task, taskMap)}</strong>
                <span className="calendar-day-item-meta">
                  <em>{t("calendar.focusedMark")}</em>
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
