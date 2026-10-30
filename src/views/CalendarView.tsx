import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FullscreenIcon } from "../components/FullscreenIcon";
import { useI18n } from "../components/LocaleProvider";
import {
  ANDROID_BACK_EVENT,
  useDismissOnAndroidBack,
} from "../lib/androidBack";
import {
  Category,
  isTaskDeleted,
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
  sessionEffectiveEndMs,
  completedTasksOnDay,
  completedFocusCountOnDay,
  calendarTasksOnDay,
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
import { formatLunarDayShort, formatShortDate } from "../lib/dateDisplay";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
import { calendarPlansOnDay } from "../lib/taskRecurrence";
import { formatTaskLineage, leafTasks } from "../lib/taskTree";
import { useFollowLocalToday, useLocalToday } from "../lib/useLocalToday";
import { isAndroidDevice, useNarrowViewport } from "../lib/viewport";

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

interface WeekFocusDetail {
  task: Task;
  session: PomodoroSession;
  day: Date;
  x: number;
  y: number;
}

export function CalendarView({
  tasks: allTasks,
  selectedTaskId,
  onSelectTask,
  onStartPomodoro,
  weekStartsOn,
  categoryFilter,
  onCategoryFilterChange,
  dataEpoch,
}: CalendarViewProps) {
  const tasks = useMemo(
    () => allTasks.filter((task) => !isTaskDeleted(task)),
    [allTasks],
  );
  const { locale, t } = useI18n();
  useCnHolidayRevision();
  const viewRef = useRef<HTMLDivElement>(null);
  const weekViewportRef = useRef<HTMLDivElement>(null);
  const today = useLocalToday();
  const android = isAndroidDevice();
  const narrow = useNarrowViewport();
  const androidWeekRotated = android && narrow;
  const [weekBoardBox, setWeekBoardBox] = useState({ width: 0, height: 0 });
  const [weekBoardFullscreen, setWeekBoardFullscreen] = useState(false);
  const [weekDetail, setWeekDetail] = useState<WeekFocusDetail | null>(null);
  const [mode, setMode] = useState<CalendarMode>("month");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() =>
    startOfLocalDay(new Date()),
  );
  useFollowLocalToday(today, setSelectedDay);
  useFollowLocalToday(today, setCursor);
  const [categories, setCategories] = useState<Category[]>([]);
  const [hideDone, setHideDone] = useState(false);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (narrow && mode === "year") setMode("month");
  }, [narrow, mode]);

  useEffect(() => {
    if (mode !== "week") {
      setWeekDetail(null);
      setWeekBoardFullscreen(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!androidWeekRotated) {
      setWeekBoardFullscreen(false);
    }
  }, [androidWeekRotated]);

  useEffect(() => {
    if (!androidWeekRotated) return;
    function onBack(event: Event) {
      if (!weekBoardFullscreen) return;
      const slot = weekViewportRef.current?.closest(".view-slot");
      if (slot?.classList.contains("is-hidden")) return;
      event.preventDefault();
      setWeekBoardFullscreen(false);
    }
    window.addEventListener(ANDROID_BACK_EVENT, onBack);
    return () => window.removeEventListener(ANDROID_BACK_EVENT, onBack);
  }, [androidWeekRotated, weekBoardFullscreen]);

  useLayoutEffect(() => {
    if (!androidWeekRotated || mode !== "week") return;
    const viewport = weekViewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const next = {
        width: viewport.clientWidth,
        height: weekBoardFullscreen
          ? window.innerHeight
          : viewport.clientHeight,
      };
      setWeekBoardBox((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [androidWeekRotated, mode, weekBoardFullscreen]);

  useEffect(() => {
    if (!androidWeekRotated) return;
    document.documentElement.classList.toggle(
      "calendar-week-fullscreen-active",
      weekBoardFullscreen && mode === "week",
    );
    return () => {
      document.documentElement.classList.remove("calendar-week-fullscreen-active");
    };
  }, [androidWeekRotated, weekBoardFullscreen, mode]);

  const toggleWeekDetail = useCallback((detail: WeekFocusDetail) => {
    setWeekDetail((prev) =>
      prev?.session.id === detail.session.id ? null : detail,
    );
  }, []);

  const handleWeekBlockHover = useCallback((detail: WeekFocusDetail | null) => {
    setWeekDetail(detail);
  }, []);

  useEffect(() => {
    if (!androidWeekRotated || !weekDetail) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(".calendar-week-focus-card, .calendar-week-color-block")
      ) {
        return;
      }
      setWeekDetail(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [androidWeekRotated, weekDetail]);

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

  const categoryTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (categoryFilter === "none") return !task.category_id;
      if (categoryFilter !== "all" && task.category_id !== categoryFilter) return false;
      return true;
    });
  }, [tasks, categoryFilter]);

  const filteredTasks = useMemo(() => {
    const leaves = new Set(leafTasks(tasks).map((task) => task.id));
    return categoryTasks.filter((task) => {
      if (!leaves.has(task.id)) return false;
      if (hideDone && task.status === "done") return false;
      return true;
    });
  }, [tasks, categoryTasks, hideDone]);

  const taskMap = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );

  // Scheduled rows stay on leaf tasks. Focus blocks still include parent tasks
  // that were timed directly, otherwise those pomodoros disappear.
  const sessionTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of categoryTasks) {
      if (hideDone && task.status === "done") continue;
      ids.add(task.id);
    }
    return ids;
  }, [categoryTasks, hideDone]);

  const scheduledTasks = useMemo(
    () =>
      filteredTasks.filter(
        (task) => task.start_at != null || task.due_at != null,
      ),
    [filteredTasks],
  );

  const visibleSessions = useMemo(
    () => sessions.filter((session) => sessionTaskIds.has(session.task_id)),
    [sessions, sessionTaskIds],
  );

  const selectedDayPlans = useMemo(
    () => calendarPlansOnDay(categoryTasks, selectedDay, today),
    [categoryTasks, selectedDay, today],
  );

  const selectedDayScheduled = useMemo(() => {
    const listed = scheduledTasksOnDay(scheduledTasks, selectedDay);
    const seen = new Set(listed.map((task) => task.id));
    return [
      ...listed,
      ...selectedDayPlans
        .map((plan) => plan.task)
        .filter((task) => !seen.has(task.id)),
    ];
  }, [scheduledTasks, selectedDay, selectedDayPlans]);

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

  const weekFocusCard =
    mode === "week" && weekDetail ? (
      <CalendarWeekFocusCard
        detail={weekDetail}
        taskMap={taskMap}
        category={
          weekDetail.task.category_id
            ? categoryMap.get(weekDetail.task.category_id) ?? null
            : null
        }
        rotated={androidWeekRotated}
        pinned={androidWeekRotated}
        onDismiss={() => setWeekDetail(null)}
      />
    ) : null;

  const androidWeekBoardStyle =
    weekBoardBox.width > 0
      ? (() => {
          const spanW = weekBoardBox.width;
          const spanH = weekBoardBox.height;
          const hourHeaderPx = 36;
          const dayRow = Math.max(20, Math.floor((spanW - hourHeaderPx) / 7));
          return {
            width: spanH,
            height: spanW,
            ["--calendar-week-day-row" as string]: `${dayRow}px`,
            ["--calendar-week-span-width" as string]: `${spanW}px`,
          };
        })()
      : undefined;

  function renderAndroidWeekViewport(fullscreen: boolean) {
    return (
      <div
        className={`calendar-week-viewport${fullscreen ? " is-fullscreen" : ""}`}
        ref={weekViewportRef}
      >
        <div className="calendar-week-board" style={androidWeekBoardStyle}>
          <WeekGrid
            anchor={cursor}
            today={today}
            selectedDay={selectedDay}
            sessions={visibleSessions}
            planTasks={categoryTasks}
            taskMap={taskMap}
            categoryMap={categoryMap}
            weekdays={weekdays}
            weekStartsOn={weekStartsOn}
            onSelectDay={(day) => selectDay(day)}
            onSelectTask={onSelectTask}
            selectedTaskId={selectedTaskId}
            onFocusBlockTap={toggleWeekDetail}
            androidLayout
          />
        </div>
        {fullscreen && (
          <button
            type="button"
            className="secondary-btn gantt-fullscreen-exit calendar-week-fullscreen-exit"
            onClick={() => setWeekBoardFullscreen(false)}
            title={t("gantt.exitFullscreen")}
            aria-label={t("gantt.exitFullscreen")}
          >
            <FullscreenIcon exit />
          </button>
        )}
        {fullscreen && weekFocusCard}
      </div>
    );
  }

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
          {androidWeekRotated && mode === "week" && (
            <button
              type="button"
              className="secondary-btn gantt-fullscreen-btn"
              onClick={() => setWeekBoardFullscreen(true)}
              title={t("gantt.fullscreen")}
              aria-label={t("gantt.fullscreen")}
            >
              <FullscreenIcon />
            </button>
          )}
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
              planTasks={categoryTasks}
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
              planTasks={categoryTasks}
              sessions={visibleSessions}
              taskMap={taskMap}
              categoryMap={categoryMap}
              weekdays={weekdays}
              weekStartsOn={weekStartsOn}
              onSelectDay={(day) => selectDay(day)}
            />
          )}
          {mode === "week" &&
            (androidWeekRotated ? (
              weekBoardFullscreen ? (
                createPortal(
                  renderAndroidWeekViewport(true),
                  document.body,
                )
              ) : (
                renderAndroidWeekViewport(false)
              )
            ) : (
              <WeekGrid
                anchor={cursor}
                today={today}
                selectedDay={selectedDay}
                sessions={visibleSessions}
                planTasks={categoryTasks}
                taskMap={taskMap}
                categoryMap={categoryMap}
                weekdays={weekdays}
                weekStartsOn={weekStartsOn}
                onSelectDay={(day) => selectDay(day)}
                onSelectTask={onSelectTask}
                selectedTaskId={selectedTaskId}
                onFocusBlockHover={handleWeekBlockHover}
              />
            ))}
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
                  planKinds={new Map(selectedDayPlans.map((plan) => [plan.task.id, plan.kind]))}
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

      {weekFocusCard &&
        !(androidWeekRotated && weekBoardFullscreen) &&
        weekFocusCard}
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
  planTasks,
  sessions,
  weekStartsOn,
  onSelectDay,
  onSelectMonth,
}: {
  year: number;
  today: Date;
  selectedDay: Date;
  tasks: Task[];
  planTasks: Task[];
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
                const listed = new Set(calendarTasksOnDay(tasks, day).map((task) => task.id));
                const planned = calendarPlansOnDay(planTasks, day, today).filter(
                  (plan) => !listed.has(plan.task.id),
                ).length;
                const count = countDayActivity(tasks, sessions, day) + planned;
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
  planTasks,
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
  planTasks: Task[];
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
          const plans = inMonth ? calendarPlansOnDay(planTasks, day, today) : [];
          const planKind = new Map(plans.map((plan) => [plan.task.id, plan.kind]));
          const dayTasks = inMonth
            ? [
                ...completedTasksOnDay(tasks, day),
                ...scheduledTasksOnDay(tasks, day).filter(
                  (task) => !taskCompletedOnDay(task, day),
                ),
                ...plans
                  .map((plan) => plan.task)
                  .filter((task) => !scheduledTasksOnDay(tasks, day).some((item) => item.id === task.id)
                    && !completedTasksOnDay(tasks, day).some((item) => item.id === task.id)),
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
            { task: Task; focus: boolean; done: boolean; planned: boolean }
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
                planned: planKind.has(task.id),
              });
            }
          }
          for (const task of dayTasks) {
            const prev = events.get(task.id);
            const done = taskCompletedOnDay(task, day);
            if (prev) {
              prev.done = prev.done || done;
              prev.planned = prev.planned || planKind.has(task.id);
            } else {
              events.set(task.id, {
                task,
                focus: false,
                done,
                planned: planKind.has(task.id),
              });
            }
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
                  const tone = [
                    event.focus && event.done
                      ? "is-both"
                      : event.done
                        ? "is-complete"
                        : event.focus
                          ? "is-focus"
                          : "",
                    event.planned ? "is-planned" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const toneTitle = event.planned
                    ? planKind.get(task.id) === "recurrence"
                      ? t("calendar.recurrenceMark")
                      : t("calendar.planned")
                    : event.focus && event.done
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
  planTasks,
  taskMap,
  categoryMap,
  weekdays,
  weekStartsOn,
  onSelectDay,
  onSelectTask,
  selectedTaskId,
  onFocusBlockTap,
  onFocusBlockHover,
  androidLayout,
}: {
  anchor: Date;
  today: Date;
  selectedDay: Date;
  sessions: PomodoroSession[];
  planTasks: Task[];
  taskMap: Map<string, Task>;
  categoryMap: Map<string, Category>;
  weekdays: string[];
  weekStartsOn: WeekStartsOn;
  onSelectDay: (day: Date) => void;
  onSelectTask: (id: string | null) => void;
  selectedTaskId: string | null;
  onFocusBlockTap?: (detail: WeekFocusDetail) => void;
  onFocusBlockHover?: (detail: WeekFocusDetail | null) => void;
  androidLayout?: boolean;
}) {
  const { t } = useI18n();
  const days = useMemo(
    () => buildWeekDays(anchor, weekStartsOn),
    [anchor, weekStartsOn],
  );

  return (
    <div
      className={`calendar-week-matrix${
        androidLayout ? " is-android-rotated" : ""
      }`}
      aria-label={t("calendar.weekView")}
      onMouseLeave={
        onFocusBlockHover
          ? (event) => {
              const next = event.relatedTarget;
              if (
                next instanceof Element &&
                next.closest(".calendar-week-color-block, .calendar-week-focus-card")
              ) {
                return;
              }
              onFocusBlockHover(null);
            }
          : undefined
      }
    >
      <div className="calendar-week-matrix-corner" aria-hidden />
      <div className="calendar-week-matrix-hours" aria-hidden>
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="calendar-week-matrix-hour-cell">
            {hour % 2 === 0 && (
              <span className="calendar-week-matrix-hour-tick">
                {String(hour).padStart(2, "0")}:00
              </span>
            )}
          </span>
        ))}
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
            {calendarPlansOnDay(planTasks, day, today).length > 0 && (
              <span className="calendar-week-plan-dot" title={t("calendar.planned")} />
            )}
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
              const minWidthPct = androidLayout ? 1.2 : 0.35;
              const color = categoryColor(task.category_id, categoryMap);
              const tip = `${formatTimeHm(session.started_at)}–${formatTimeHm(
                sessionEffectiveEndMs(session),
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
                    width: `${Math.max(widthPct, minWidthPct)}%`,
                    backgroundColor: color,
                  }}
                  title={tip}
                  aria-label={tip}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectDay(day);
                    onSelectTask(task.id);
                    onFocusBlockTap?.({
                      task,
                      session,
                      day,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onMouseEnter={
                    onFocusBlockHover
                      ? (event) => {
                          onFocusBlockHover({
                            task,
                            session,
                            day,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }
                      : undefined
                  }
                  onMouseMove={
                    onFocusBlockHover
                      ? (event) => {
                          onFocusBlockHover({
                            task,
                            session,
                            day,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }
                      : undefined
                  }
                  onMouseLeave={
                    onFocusBlockHover
                      ? (event) => {
                          const next = event.relatedTarget;
                          if (
                            next instanceof Element &&
                            (next.closest(".calendar-week-color-block") ||
                              next.closest(".calendar-week-focus-card"))
                          ) {
                            return;
                          }
                          onFocusBlockHover(null);
                        }
                      : undefined
                  }
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
  planKinds,
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
  planKinds?: ReadonlyMap<string, "start" | "recurrence">;
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
          const planKind = planKinds?.get(task.id);
          return (
            <li
              key={task.id}
              className={`calendar-day-item${
                selectedTaskId === task.id ? " is-selected" : ""
              }${task.status === "done" ? " is-done" : ""}${
                planKind ? " is-planned" : ""
              }`}
            >
              <button
                type="button"
                className="calendar-day-item-main"
                onClick={() => onSelectTask(task.id)}
              >
                <strong>{formatTaskLineage(task, taskMap)}</strong>
                <span className="calendar-day-item-meta">
                  {planKind === "recurrence" && <em>{t("calendar.recurrenceMark")}</em>}
                  {planKind === "start" && <em>{t("calendar.planned")}</em>}
                  {marker === "done" && <em>{t("calendar.finishedMark")}</em>}
                  {planKind !== "start" && marker === "start" && <em>{t("calendar.startMark")}</em>}
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

function calendarWeekFocusPositionUpright(
  x: number,
  y: number,
): { left: number; top: number } {
  const margin = 8;
  return {
    left: Math.min(
      x + 14,
      Math.max(margin, window.innerWidth - 280 - margin),
    ),
    top: Math.min(
      y + 16,
      Math.max(margin, window.innerHeight - 180 - margin),
    ),
  };
}

function calendarWeekFocusPositionRotated(
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

function CalendarWeekFocusCard({
  detail,
  taskMap,
  category,
  rotated,
  pinned,
  onDismiss,
}: {
  detail: WeekFocusDetail;
  taskMap: Map<string, Task>;
  category: Category | null;
  rotated: boolean;
  pinned: boolean;
  onDismiss: () => void;
}) {
  const { locale, t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  useDismissOnAndroidBack(pinned, onDismiss, cardRef);
  const [size, setSize] = useState({ width: 240, height: 140 });
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
    ? calendarWeekFocusPositionRotated(
        detail.x,
        detail.y,
        size.width,
        size.height,
      )
    : calendarWeekFocusPositionUpright(detail.x, detail.y);
  const { task, session, day } = detail;
  const priority =
    task.priority === "high"
      ? t("common.priorityHighShort")
      : task.priority === "medium"
        ? t("common.priorityMediumShort")
        : t("common.priorityLowShort");
  return (
    <div
      ref={cardRef}
      className={`calendar-week-focus-card${rotated ? " is-rotated" : ""}`}
      style={{ left, top }}
      role="tooltip"
    >
      <strong>{formatTaskLineage(task, taskMap)}</strong>
      <p>{formatDayPanelTitle(day, locale)}</p>
      <p>
        {t("calendar.focusedMark")}{" "}
        {formatTimeHm(session.started_at)}–
        {formatTimeHm(sessionEffectiveEndMs(session))}
      </p>
      <p>
        {task.status === "done" ? t("common.done") : t("common.notDone")}
        {` · ${t("calendar.priority", { level: priority })}`}
        {category ? ` · ${category.name}` : ""}
      </p>
      <p>
        {t("gantt.clocks", {
          done: formatPomodoroAmount(task.completed_pomodoros ?? 0),
          estimate: task.estimate_pomodoros ?? 0,
        })}
      </p>
      {(task.start_at != null || task.due_at != null) && (
        <p>
          {task.start_at
            ? t("gantt.starts", {
                date: formatShortDate(task.start_at, locale),
              })
            : ""}
          {task.start_at && task.due_at ? " · " : ""}
          {task.due_at
            ? t("gantt.due", { date: formatShortDate(task.due_at, locale) })
            : ""}
        </p>
      )}
    </div>
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
                    {formatTimeHm(sessionEffectiveEndMs(session))}
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
