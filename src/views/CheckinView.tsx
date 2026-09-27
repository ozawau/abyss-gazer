import { useEffect, useMemo, useState } from "react";
import { HabitCheckinDialog } from "../components/HabitCheckinDialog";
import { useI18n } from "../components/LocaleProvider";
import { WEEKDAY_SHORT } from "../lib/i18n";
import {
  Category,
  listCategories,
  listHabitCheckinItems,
  listHabitCheckins,
  listPomodoroSessionsInRange,
  PomodoroSession,
  saveHabitCheckin,
  Task,
} from "../lib/api";
import type { WeekStartsOn } from "../lib/api";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  buildWeekDays,
  dayKey,
  formatMonthTitle,
  formatWeekTitle,
  sameDay,
  startOfLocalDay,
  weekdayShortLabels,
} from "../lib/calendar";
import { useCnHolidayRevision } from "../lib/cnHolidayData";
import { statutoryDayInfo } from "../lib/cnStatutoryDay";
import { formatLunarDayShort } from "../lib/dateDisplay";
import { descendantIds } from "../lib/taskTree";

interface CheckinViewProps {
  tasks: Task[];
  weekStartsOn: WeekStartsOn;
  dataEpoch: number;
}

type CheckinMode = "month" | "week";
type Mark = "checked" | "missed";

interface CheckinDetail {
  note: string;
  taskIds: string[];
}

function checkinKey(taskId: string, day: string): string {
  return `${taskId}|${day}`;
}

function dayChecked(
  habitId: string,
  day: Date,
  manual: Set<string>,
  auto: Set<string>,
): boolean {
  const key = checkinKey(habitId, dayKey(day));
  return manual.has(key) || auto.has(key);
}

interface StreakSpan {
  current: number;
  best: number;
}

/** Current run ending today, plus the longest run since `start`. An unchecked today does not break the current run. */
function streakSpan(start: Date, today: Date, isOn: (day: Date) => boolean): StreakSpan {
  const end = startOfLocalDay(today).getTime();
  let cursor = startOfLocalDay(start);
  if (cursor.getTime() > end) return { current: 0, best: 0 };
  let run = 0;
  let best = 0;
  let current = 0;
  while (cursor.getTime() <= end) {
    const isToday = cursor.getTime() === end;
    if (isOn(cursor)) {
      run += 1;
      if (run > best) best = run;
      current = run;
    } else if (!isToday) {
      run = 0;
      current = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return { current, best };
}

function habitStreakSpan(
  habit: Task,
  manual: Set<string>,
  auto: Set<string>,
  today: Date,
): StreakSpan {
  return streakSpan(new Date(habit.created_at), today, (day) =>
    dayChecked(habit.id, day, manual, auto),
  );
}

function perfectStreakSpan(
  habits: Task[],
  manual: Set<string>,
  auto: Set<string>,
  today: Date,
): StreakSpan {
  if (habits.length === 0) return { current: 0, best: 0 };
  let earliest = today.getTime();
  for (const habit of habits) {
    const created = startOfLocalDay(new Date(habit.created_at)).getTime();
    if (created < earliest) earliest = created;
  }
  return streakSpan(new Date(earliest), today, (day) =>
    dayIsPerfect(habits, day, manual, auto),
  );
}

function dayIsPerfect(
  habits: Task[],
  day: Date,
  manual: Set<string>,
  auto: Set<string>,
): boolean {
  const dayMs = startOfLocalDay(day).getTime();
  const applicable = habits.filter(
    (habit) => dayMs >= startOfLocalDay(new Date(habit.created_at)).getTime(),
  );
  return (
    applicable.length > 0 &&
    applicable.every((habit) => dayChecked(habit.id, day, manual, auto))
  );
}

function checkinTotals(
  habits: Task[],
  manual: Set<string>,
  auto: Set<string>,
  today: Date,
): { perfectDays: number; checked: number; missed: number } {
  if (habits.length === 0) return { perfectDays: 0, checked: 0, missed: 0 };
  let earliest = today.getTime();
  for (const habit of habits) {
    const created = startOfLocalDay(new Date(habit.created_at)).getTime();
    if (created < earliest) earliest = created;
  }
  const end = startOfLocalDay(today).getTime();
  let cursor = new Date(earliest);
  let perfectDays = 0;
  let checked = 0;
  let missed = 0;
  while (cursor.getTime() <= end) {
    const dayMs = cursor.getTime();
    const applicable = habits.filter(
      (habit) => startOfLocalDay(new Date(habit.created_at)).getTime() <= dayMs,
    );
    if (applicable.length > 0) {
      let allChecked = true;
      for (const habit of applicable) {
        if (dayChecked(habit.id, cursor, manual, auto)) checked += 1;
        else {
          missed += 1;
          allChecked = false;
        }
      }
      if (allChecked) perfectDays += 1;
    }
    cursor = addDays(cursor, 1);
  }
  return { perfectDays, checked, missed };
}

function isHabitRoot(task: Task, categories: Map<string, Category>): boolean {
  if (task.parent_id) return false;
  if (!task.category_id) return false;
  const name = categories.get(task.category_id)?.name ?? "";
  return name.trim().toLowerCase() === "habit";
}

export function CheckinView({ tasks, weekStartsOn, dataEpoch }: CheckinViewProps) {
  const { locale, t } = useI18n();
  useCnHolidayRevision();
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const [mode, setMode] = useState<CheckinMode>("week");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [categories, setCategories] = useState<Category[]>([]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Map<string, CheckinDetail>>(() => new Map());
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [streakManual, setStreakManual] = useState<Set<string>>(() => new Set());
  const [streakSessions, setStreakSessions] = useState<PomodoroSession[]>([]);
  const [editor, setEditor] = useState<{ habit: Task; day: Date } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const category of categories) map.set(category.id, category);
    return map;
  }, [categories]);

  const habits = useMemo(
    () =>
      tasks
        .filter((task) => isHabitRoot(task, categoryMap))
        .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh")),
    [tasks, categoryMap],
  );

  const historyStart = useMemo(() => {
    let earliest = today.getTime();
    for (const habit of habits) {
      const created = startOfLocalDay(new Date(habit.created_at)).getTime();
      if (created < earliest) earliest = created;
    }
    return earliest;
  }, [habits, today]);

  const visibleDays = useMemo(
    () =>
      mode === "week"
        ? buildWeekDays(cursor, weekStartsOn)
        : buildMonthGrid(cursor, weekStartsOn),
    [mode, cursor, weekStartsOn],
  );

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
    const start = visibleDays[0];
    const end = visibleDays[visibleDays.length - 1];
    if (!start || !end) return;
    let cancelled = false;
    listHabitCheckins(dayKey(start), dayKey(end))
      .then(async (rows) => {
        const items = await listHabitCheckinItems(dayKey(start), dayKey(end));
        if (cancelled) return;
        setChecked(new Set(rows.map((row) => checkinKey(row.task_id, row.day))));
        const next = new Map<string, CheckinDetail>();
        for (const row of rows) {
          next.set(checkinKey(row.task_id, row.day), { note: row.note ?? "", taskIds: [] });
        }
        for (const item of items) {
          const key = checkinKey(item.habit_id, item.day);
          const detail = next.get(key) ?? { note: "", taskIds: [] };
          detail.taskIds.push(item.task_id);
          next.set(key, detail);
        }
        setDetails(next);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [visibleDays, dataEpoch]);

  useEffect(() => {
    const start = visibleDays[0];
    const end = visibleDays[visibleDays.length - 1];
    if (!start || !end) return;
    let cancelled = false;
    const startMs = startOfLocalDay(start).getTime();
    const endMs = addDays(startOfLocalDay(end), 1).getTime();
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
  }, [visibleDays, dataEpoch]);

  useEffect(() => {
    if (habits.length === 0) return;
    let cancelled = false;
    const startDay = dayKey(new Date(historyStart));
    const endDay = dayKey(today);
    const endMs = addDays(today, 1).getTime();
    Promise.all([
      listHabitCheckins(startDay, endDay),
      listPomodoroSessionsInRange(historyStart, endMs),
    ])
      .then(([rows, focus]) => {
        if (cancelled) return;
        setStreakManual(new Set(rows.map((row) => checkinKey(row.task_id, row.day))));
        setStreakSessions(focus);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [habits.length, historyStart, today, dataEpoch]);

  const autoChecked = useMemo(() => {
    const habitOfChild = new Map<string, string>();
    for (const habit of habits) {
      habitOfChild.set(habit.id, habit.id);
      for (const id of descendantIds(habit.id, tasks)) habitOfChild.set(id, habit.id);
    }
    const keys = new Set<string>();
    for (const session of sessions) {
      if (session.kind !== "focus" || !session.completed) continue;
      const habitId = habitOfChild.get(session.task_id);
      if (!habitId) continue;
      const day = dayKey(startOfLocalDay(new Date(session.started_at)));
      keys.add(checkinKey(habitId, day));
    }
    return keys;
  }, [habits, tasks, sessions]);

  const streaks = useMemo(() => {
    const habitOfChild = new Map<string, string>();
    for (const habit of habits) {
      habitOfChild.set(habit.id, habit.id);
      for (const id of descendantIds(habit.id, tasks)) habitOfChild.set(id, habit.id);
    }
    const auto = new Set<string>();
    for (const session of streakSessions) {
      if (session.kind !== "focus" || !session.completed) continue;
      const habitId = habitOfChild.get(session.task_id);
      if (!habitId) continue;
      auto.add(checkinKey(habitId, dayKey(startOfLocalDay(new Date(session.started_at)))));
    }
    const map = new Map<string, StreakSpan>();
    let longest = 0;
    for (const habit of habits) {
      const span = habitStreakSpan(habit, streakManual, auto, today);
      map.set(habit.id, span);
      if (span.best > longest) longest = span.best;
    }
    return {
      byHabit: map,
      perfect: perfectStreakSpan(habits, streakManual, auto, today),
      totals: checkinTotals(habits, streakManual, auto, today),
      longest,
    };
  }, [habits, tasks, streakManual, streakSessions, today]);

  const weekdays = weekdayShortLabels(weekStartsOn, locale);
  const title =
    mode === "week"
      ? formatWeekTitle(visibleDays[0] ?? cursor, locale)
      : formatMonthTitle(cursor, locale);

  function markFor(task: Task, day: Date): Mark | null {
    const dayMs = startOfLocalDay(day).getTime();
    if (dayMs > today.getTime()) return null;
    const createdMs = startOfLocalDay(new Date(task.created_at)).getTime();
    if (dayMs < createdMs) return null;
    const key = checkinKey(task.id, dayKey(day));
    return checked.has(key) || autoChecked.has(key) ? "checked" : "missed";
  }

  function checkedByClock(task: Task, day: Date): boolean {
    return autoChecked.has(checkinKey(task.id, dayKey(day)));
  }

  function detailNote(task: Task, day: Date): string {
    return details.get(checkinKey(task.id, dayKey(day)))?.note ?? "";
  }

  function clockTaskIds(habit: Task, day: Date): string[] {
    const family = new Set([habit.id, ...descendantIds(habit.id, tasks)]);
    const target = dayKey(startOfLocalDay(day));
    const hit = new Set<string>();
    for (const session of sessions) {
      if (session.kind !== "focus" || !session.completed) continue;
      if (!family.has(session.task_id)) continue;
      if (dayKey(startOfLocalDay(new Date(session.started_at))) !== target) continue;
      hit.add(session.task_id);
    }
    if (hit.size === 0) return [];
    const ordered = [habit.id];
    for (const id of descendantIds(habit.id, tasks)) ordered.push(id);
    return ordered.filter((id) => hit.has(id));
  }

  function selectionFor(habit: Task, day: Date): string[] {
    const saved = details.get(checkinKey(habit.id, dayKey(day)))?.taskIds ?? [];
    const savedSet = new Set(saved);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of [...clockTaskIds(habit, day), ...saved]) {
      if (seen.has(id)) continue;
      const task = byId.get(id);
      if (task && task.id !== habit.id && task.status === "done" && !savedSet.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
    return ids.length > 0 ? ids : [habit.id];
  }

  function openCheckin(task: Task, day: Date) {
    if (markFor(task, day) == null) return;
    setEditor({ habit: task, day });
  }

  async function saveCheckin(input: {
    checked: boolean;
    note: string;
    selectedIds: string[];
  }) {
    if (!editor || saving) return;
    const key = checkinKey(editor.habit.id, dayKey(editor.day));
    setSaving(true);
    setError(null);
    try {
      await saveHabitCheckin({
        taskId: editor.habit.id,
        day: dayKey(editor.day),
        checked: input.checked,
        note: input.note,
        taskIds: input.selectedIds,
      });
      setChecked((prev) => {
        const next = new Set(prev);
        if (input.checked) next.add(key);
        else next.delete(key);
        return next;
      });
      setStreakManual((prev) => {
        const next = new Set(prev);
        if (input.checked) next.add(key);
        else next.delete(key);
        return next;
      });
      setDetails((prev) => {
        const next = new Map(prev);
        if (input.checked) {
          next.set(key, { note: input.note, taskIds: input.selectedIds });
        } else {
          next.delete(key);
        }
        return next;
      });
      setEditor(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="view calendar-view habit-view">
      <header className="view-header calendar-header">
        <div className="calendar-header-main">
          <h1>{t("checkin.title")}</h1>
          <p>{t("checkin.hint")}</p>
        </div>
        <div className="calendar-toolbar">
          <div className="calendar-mode-tabs" role="tablist" aria-label={t("checkin.view")}>
            {(
              [
                ["month", t("calendar.month")],
                ["week", t("calendar.week")],
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
            <button
              type="button"
              className="secondary-btn"
              onClick={() =>
                setCursor((day) =>
                  mode === "week" ? addDays(day, -7) : addMonths(day, -1),
                )
              }
            >
              {t("common.prev")}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setCursor(startOfLocalDay(new Date()))}
            >
              {t("common.today")}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={() =>
                setCursor((day) =>
                  mode === "week" ? addDays(day, 7) : addMonths(day, 1),
                )
              }
            >
              {t("common.next")}
            </button>
          </div>
        </div>
      </header>

      <div className="calendar-filters">
        <strong className="calendar-period-title">{title}</strong>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {habits.length === 0 && (
        <p className="habit-empty">
          {t("checkin.empty")}
        </p>
      )}

      {mode === "month" ? (
        <MonthCheckins
          anchor={cursor}
          today={today}
          habits={habits}
          weekdays={weekdays}
          weekStartsOn={weekStartsOn}
          markFor={markFor}
          checkedByClock={checkedByClock}
          detailNote={detailNote}
          onOpen={openCheckin}
          onSelectDay={setCursor}
        />
      ) : (
        <>
          <ul className="tasks-day-stats habit-week-stats" aria-label={t("checkin.stats")}>
            <li>
              <span className="stat-label">{t("checkin.perfectDays")}</span>
              <strong>{streaks.totals.perfectDays}</strong>
            </li>
            <li title={t("checkin.bestStreakTitle")}>
              <span className="stat-label">{t("checkin.bestStreak")}</span>
              <strong>{streaks.longest}</strong>
            </li>
            <li>
              <span className="stat-label">{t("checkin.checkinCount")}</span>
              <strong>{streaks.totals.checked}</strong>
            </li>
            <li title={t("checkin.rateTitle")}>
              <span className="stat-label">{t("checkin.rate")}</span>
              <strong>
                {streaks.totals.checked + streaks.totals.missed === 0
                  ? "0%"
                  : `${Math.round(
                      (streaks.totals.checked * 100) /
                        (streaks.totals.checked + streaks.totals.missed),
                    )}%`}
              </strong>
            </li>
          </ul>
          <WeekCheckins
            days={visibleDays}
            today={today}
            habits={habits}
            markFor={markFor}
            checkedByClock={checkedByClock}
            detailNote={detailNote}
            streaks={streaks.byHabit}
            perfectStreak={streaks.perfect}
            onOpen={openCheckin}
          />
        </>
      )}
      <HabitCheckinDialog
        key={
          editor ? `${editor.habit.id}|${dayKey(editor.day)}` : "habit-checkin-closed"
        }
        habit={editor?.habit ?? null}
        day={editor?.day ?? null}
        tasks={tasks}
        initialChecked
        checkedByClock={
          editor ? checkedByClock(editor.habit, editor.day) : false
        }
        initialNote={
          editor
            ? (details.get(checkinKey(editor.habit.id, dayKey(editor.day)))?.note ?? "")
            : ""
        }
        initialSelected={editor ? selectionFor(editor.habit, editor.day) : []}
        recordedIds={
          editor
            ? (details.get(checkinKey(editor.habit.id, dayKey(editor.day)))?.taskIds ?? [])
            : []
        }
        busy={saving}
        onCancel={() => {
          if (!saving) setEditor(null);
        }}
        onSave={(input) => void saveCheckin(input)}
      />
    </div>
  );
}

function HabitMark({
  mark,
  label,
  title,
  onClick,
}: {
  mark: Mark;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  const checked = mark === "checked";
  return (
    <button
      type="button"
      className={`habit-mark${checked ? " is-checked" : " is-missed"}`}
      aria-label={label}
      aria-pressed={checked}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span aria-hidden>{checked ? "✓" : "✗"}</span>
    </button>
  );
}

function MonthCheckins({
  anchor,
  today,
  habits,
  weekdays,
  weekStartsOn,
  markFor,
  checkedByClock,
  detailNote,
  onOpen,
  onSelectDay,
}: {
  anchor: Date;
  today: Date;
  habits: Task[];
  weekdays: string[];
  weekStartsOn: WeekStartsOn;
  markFor: (task: Task, day: Date) => Mark | null;
  checkedByClock: (task: Task, day: Date) => boolean;
  detailNote: (task: Task, day: Date) => string;
  onOpen: (task: Task, day: Date) => void;
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
        {weekdays.map((label) => (
          <span
            key={label}
            className={(weekStartsOn + weekdays.indexOf(label)) % 7 === 0 || (weekStartsOn + weekdays.indexOf(label)) % 7 === 6 ? "is-weekend" : undefined}
          >
            {t("calendar.weekdayPrefix", { day: label })}
          </span>
        ))}
      </div>
      <div className="calendar-month-grid">
        {cells.map((day) => {
          const inMonth = day.getMonth() === month;
          const statutory = statutoryDayInfo(day);
          const lunar = formatLunarDayShort(day, locale);
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div
              key={dayKey(day)}
              className={`calendar-month-cell habit-month-cell${
                inMonth ? "" : " is-outside"
              }${sameDay(day, today) ? " is-today" : ""}${
                statutory?.mark === "holiday"
                  ? " has-statutory-holiday"
                  : statutory?.mark === "adjusted-workday"
                    ? " has-statutory-workday"
                    : ""
              }${weekend ? " is-weekend" : ""}`}
              onClick={() => onSelectDay(startOfLocalDay(day))}
            >
              <span className="calendar-month-dayhead">
                <span className="calendar-month-daynums">
                  <span className="calendar-month-daynum">{day.getDate()}</span>
                  {lunar && <span className="calendar-month-lunar">{lunar}</span>}
                </span>
                {statutory && (
                  <span
                    className={`calendar-month-statutory is-${statutory.mark}`}
                    aria-hidden
                  >
                    {statutory.mark === "holiday" ? t("calendar.rest") : t("calendar.work")}
                  </span>
                )}
              </span>
              {inMonth && (
                <ul className="habit-month-list">
                  {habits.map((task) => {
                    const mark = markFor(task, day);
                    if (!mark) return null;
                    const on = mark === "checked";
                    const byClock = checkedByClock(task, day);
                    const note = detailNote(task, day);
                    const status = on
                      ? byClock
                        ? t("checkin.checkedByClock")
                        : t("checkin.checked")
                      : t("checkin.missed");
                    const title = [byClock ? t("checkin.clockNote") : "", note]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          className="habit-month-item"
                          aria-pressed={on}
                          aria-label={`${task.title}${status}`}
                          title={title || undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(task, day);
                          }}
                        >
                          <span className="habit-month-title">{task.title}</span>
                          <span
                            className={`habit-glyph${on ? " is-checked" : " is-missed"}`}
                            aria-hidden
                          >
                            {on ? "✓" : "✗"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordCell({ current, best }: StreakSpan) {
  const { t } = useI18n();
  return (
    <div className="habit-week-cell habit-week-record" role="gridcell">
      <span
        className={`habit-record${current > 0 ? " is-active" : ""}`}
        aria-label={t("checkin.streakLabel", { current, best })}
      >
        <strong>{current}</strong>
        <span className="habit-record-best">/{best}</span>
      </span>
      <span className="habit-record-tip" role="tooltip">
        <span>{t("checkin.streakCurrent", { count: current })}</span>
        <span>{t("checkin.streakBest", { count: best })}</span>
      </span>
    </div>
  );
}

function WeekCheckins({
  days,
  today,
  habits,
  markFor,
  checkedByClock,
  detailNote,
  streaks,
  perfectStreak,
  onOpen,
}: {
  days: Date[];
  today: Date;
  habits: Task[];
  markFor: (task: Task, day: Date) => Mark | null;
  checkedByClock: (task: Task, day: Date) => boolean;
  detailNote: (task: Task, day: Date) => string;
  streaks: Map<string, StreakSpan>;
  perfectStreak: StreakSpan;
  onOpen: (task: Task, day: Date) => void;
}) {
  const { locale, t } = useI18n();
  const weekday = WEEKDAY_SHORT[locale];

  return (
    <div className="habit-week" role="grid" aria-label={t("checkin.weekGrid")}>
      <div className="habit-week-row is-head" role="row">
        <div className="habit-week-corner" />
        <div className="habit-week-head habit-week-record-head">{t("checkin.streakColumn")}</div>
        {days.map((day) => {
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div
              key={dayKey(day)}
              className={`habit-week-head${sameDay(day, today) ? " is-today" : ""}${
                weekend ? " is-weekend" : ""
              }`}
            >
              <span>{t("calendar.weekdayPrefix", { day: weekday[day.getDay()] })}</span>
              <strong>{day.getDate()}</strong>
            </div>
          );
        })}
      </div>
      {habits.map((task) => {
        const streak = streaks.get(task.id) ?? { current: 0, best: 0 };
        return (
        <div key={task.id} className="habit-week-row" role="row">
          <div className="habit-week-name" title={task.title}>
            <span className="habit-week-title">{task.title}</span>
          </div>
          <RecordCell current={streak.current} best={streak.best} />
          {days.map((day) => {
            const mark = markFor(task, day);
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <div
                key={dayKey(day)}
                className={`habit-week-cell${sameDay(day, today) ? " is-today" : ""}${
                  weekend ? " is-weekend" : ""
                }`}
                role="gridcell"
              >
                {mark && (
                  <HabitMark
                    mark={mark}
                    label={t("checkin.dayStatus", {
                      title: task.title,
                      date: t("checkin.monthDay", {
                        month: day.getMonth() + 1,
                        day: day.getDate(),
                      }),
                      status:
                        mark === "checked"
                          ? checkedByClock(task, day)
                            ? t("checkin.checkedByClock")
                            : t("checkin.checked")
                          : t("checkin.missed"),
                    })}
                    title={
                      [
                        checkedByClock(task, day) ? t("checkin.clockNote") : "",
                        detailNote(task, day),
                      ]
                        .filter(Boolean)
                        .join("\n") || undefined
                    }
                    onClick={() => onOpen(task, day)}
                  />
                )}
              </div>
            );
          })}
        </div>
        );
      })}
      <div className="habit-week-row is-perfect" role="row">
        <div className="habit-week-name" title={t("checkin.perfectTitle", { current: perfectStreak.current, best: perfectStreak.best })}>
          <span className="habit-week-title">{t("checkin.perfect")}</span>
        </div>
        <RecordCell current={perfectStreak.current} best={perfectStreak.best} />
        {days.map((day) => {
          const applicable = habits.filter((task) => markFor(task, day) != null);
          const perfect =
            applicable.length > 0 &&
            applicable.every((task) => markFor(task, day) === "checked");
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          return (
            <div
              key={dayKey(day)}
              className={`habit-week-cell${sameDay(day, today) ? " is-today" : ""}${
                weekend ? " is-weekend" : ""
              }${perfect ? " is-perfect" : ""}`}
              role="gridcell"
            >
              {perfect && (
                <span className="habit-medal" role="img" aria-label={t("checkin.perfect")} title={t("checkin.perfectMedal")}>
                  <svg viewBox="0 0 32 36" className="habit-medal-icon" aria-hidden>
                    <path fill="#dc2626" d="M6.5 1h6l1.6 13h-6z" />
                    <path fill="#b91c1c" d="M19.5 1H25.5l-1.6 13h-6z" />
                    <circle cx="16" cy="23" r="10" fill="#f6c445" stroke="#a16207" strokeWidth="1.5" />
                    <path
                      fill="#fff8e1"
                      d="M16 16.2 17.7 19.8l4 .45-3 2.7.85 3.9L16 24.8l-3.55 2.05.85-3.9-3-2.7 4-.45z"
                    />
                  </svg>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
