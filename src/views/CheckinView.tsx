import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { CheckinWeekdayFields } from "../components/CheckinWeekdayFields";
import { HabitCheckinDialog } from "../components/HabitCheckinDialog";
import { placeAnchoredTaskCard } from "../components/TaskHoverCard";
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
  SystemSettings,
  isTaskDeleted,
  Task,
  updateTask,
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
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { useCnHolidayRevision } from "../lib/cnHolidayData";
import {
  encodeCheckinWeekdays,
  habitScheduledOn,
  parseCheckinWeekdays,
} from "../lib/checkinSchedule";
import { statutoryDayInfo } from "../lib/cnStatutoryDay";
import { formatLunarDayShort } from "../lib/dateDisplay";
import { descendantIds } from "../lib/taskTree";
import {
  categoryNameById,
  isCheckinRootTask,
  resolveCheckinCategoryId,
} from "../lib/taskCategories";
import { useFollowLocalToday, useLocalToday } from "../lib/useLocalToday";

interface CheckinViewProps {
  tasks: Task[];
  systemSettings: SystemSettings;
  weekStartsOn: WeekStartsOn;
  dataEpoch: number;
  onTasksChange: (tasks: Task[]) => void;
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

type DayRole = "hit" | "miss" | "skip";

/** Current run ending today, plus the longest run since `start`. An unchecked today does not break the current run. Days the habit is not scheduled neither count nor break the run. */
function streakSpan(start: Date, today: Date, roleOf: (day: Date) => DayRole): StreakSpan {
  const end = startOfLocalDay(today).getTime();
  let cursor = startOfLocalDay(start);
  if (cursor.getTime() > end) return { current: 0, best: 0 };
  let run = 0;
  let best = 0;
  let current = 0;
  while (cursor.getTime() <= end) {
    const isToday = cursor.getTime() === end;
    const role = roleOf(cursor);
    if (role === "hit") {
      run += 1;
      if (run > best) best = run;
      current = run;
    } else if (role === "miss" && !isToday) {
      run = 0;
      current = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return { current, best };
}

function habitApplies(habit: Task, day: Date): boolean {
  const dayMs = startOfLocalDay(day).getTime();
  const createdMs = startOfLocalDay(new Date(habit.created_at)).getTime();
  return dayMs >= createdMs && habitScheduledOn(habit.checkin_weekdays, day);
}

function habitStreakSpan(
  habit: Task,
  manual: Set<string>,
  auto: Set<string>,
  today: Date,
): StreakSpan {
  return streakSpan(new Date(habit.created_at), today, (day) => {
    if (!habitScheduledOn(habit.checkin_weekdays, day)) return "skip";
    return dayChecked(habit.id, day, manual, auto) ? "hit" : "miss";
  });
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
  return streakSpan(new Date(earliest), today, (day) => {
    const applicable = habits.filter((habit) => habitApplies(habit, day));
    if (applicable.length === 0) return "skip";
    return applicable.every((habit) => dayChecked(habit.id, day, manual, auto)) ? "hit" : "miss";
  });
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
    const applicable = habits.filter((habit) => habitApplies(habit, cursor));
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

export function CheckinView({
  tasks,
  systemSettings,
  weekStartsOn,
  dataEpoch,
  onTasksChange,
}: CheckinViewProps) {
  const { locale, t } = useI18n();
  useCnHolidayRevision();
  const today = useLocalToday();
  const [mode, setMode] = useState<CheckinMode>("week");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  useFollowLocalToday(today, setCursor);
  const [categories, setCategories] = useState<Category[]>([]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [details, setDetails] = useState<Map<string, CheckinDetail>>(() => new Map());
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [streakManual, setStreakManual] = useState<Set<string>>(() => new Set());
  const [streakSessions, setStreakSessions] = useState<PomodoroSession[]>([]);
  const [editor, setEditor] = useState<{ habit: Task; day: Date } | null>(null);
  const [scheduleHabit, setScheduleHabit] = useState<Task | null>(null);
  const pendingHabitRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkinCategoryId = useMemo(
    () => resolveCheckinCategoryId(systemSettings, categories),
    [systemSettings, categories],
  );
  const checkinCategoryName =
    categoryNameById(categories, checkinCategoryId) ??
    t("checkin.unconfiguredCategory");

  const habits = useMemo(
    () =>
      tasks
        .filter((task) => !isTaskDeleted(task) && isCheckinRootTask(task, checkinCategoryId))
        .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "zh")),
    [tasks, checkinCategoryId],
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

  function openHabitEditor(habitId: string) {
    const habit = tasks.find((task) => task.id === habitId);
    if (!habit) {
      pendingHabitRef.current = habitId;
      return;
    }
    pendingHabitRef.current = null;
    setEditor({ habit, day: startOfLocalDay(new Date()) });
  }

  useEffect(() => {
    if (!pendingHabitRef.current) return;
    const habit = tasks.find((task) => task.id === pendingHabitRef.current);
    if (!habit) return;
    pendingHabitRef.current = null;
    setEditor({ habit, day: startOfLocalDay(new Date()) });
  }, [tasks]);

  useEffect(() => {
    const win = window as Window & { __abyssPendingCheckinHabit?: string | null };
    function onOpenHabit(event: Event) {
      const detail = (event as CustomEvent<{ habitId?: string }>).detail;
      if (detail?.habitId) openHabitEditor(detail.habitId);
    }
    window.addEventListener("abyss-open-checkin-habit", onOpenHabit);
    if (win.__abyssPendingCheckinHabit) {
      const id = win.__abyssPendingCheckinHabit;
      win.__abyssPendingCheckinHabit = null;
      openHabitEditor(id);
    }
    return () => window.removeEventListener("abyss-open-checkin-habit", onOpenHabit);
  }, [tasks]);

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
    if (!habitApplies(task, day)) return null;
    const key = checkinKey(task.id, dayKey(day));
    return checked.has(key) || autoChecked.has(key) ? "checked" : "missed";
  }

  function checkedByClock(task: Task, day: Date): boolean {
    return autoChecked.has(checkinKey(task.id, dayKey(day)));
  }

  function detailNote(task: Task, day: Date): string {
    return details.get(checkinKey(task.id, dayKey(day)))?.note ?? "";
  }

  function detailCheckedTitles(task: Task, day: Date): string[] {
    const ids = selectionFor(task, day);
    if (ids.length === 0) return [];
    const byId = new Map(tasks.map((row) => [row.id, row]));
    const titles: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      // Parent habit itself is the float title; only list checked subtasks.
      if (id === task.id) continue;
      const row = byId.get(id);
      if (!row || seen.has(row.title)) continue;
      seen.add(row.title);
      titles.push(row.title);
    }
    return titles;
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

  async function saveSchedule(value: string | null) {
    if (!scheduleHabit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateTask({ id: scheduleHabit.id, checkin_weekdays: value });
      onTasksChange(tasks.map((task) => (task.id === next.id ? next : task)));
      setScheduleHabit(null);
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
          <p>{t("checkin.hint", { category: checkinCategoryName })}</p>
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
        <span className="habit-note-legend"><HabitNoteIndicator />{t("checkin.hasNote")}</span>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {habits.length === 0 && (
        <p className="habit-empty">
          {!checkinCategoryId
            ? t("checkin.noCategoryConfigured")
            : t("checkin.empty", { category: checkinCategoryName })}
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
          detailCheckedTitles={detailCheckedTitles}
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
            detailCheckedTitles={detailCheckedTitles}
            streaks={streaks.byHabit}
            perfectStreak={streaks.perfect}
            onOpen={openCheckin}
            onSchedule={setScheduleHabit}
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
      <CheckinScheduleDialog
        habit={scheduleHabit}
        busy={saving}
        onCancel={() => {
          if (!saving) setScheduleHabit(null);
        }}
        onSave={(value) => void saveSchedule(value)}
      />
    </div>
  );
}

function CheckinScheduleDialog({
  habit,
  busy,
  onCancel,
  onSave,
}: {
  habit: Task | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (value: string | null) => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const parsed = habit ? parseCheckinWeekdays(habit.checkin_weekdays) : null;
  const [everyDay, setEveryDay] = useState(parsed == null);
  const [days, setDays] = useState<number[]>(parsed ?? [1, 2, 3, 4, 5, 6, 0]);
  useDismissOnAndroidBack(habit != null, () => {
    if (!busy) onCancel();
  }, rootRef);

  useEffect(() => {
    const next = habit ? parseCheckinWeekdays(habit.checkin_weekdays) : null;
    setEveryDay(next == null);
    setDays(next ?? [1, 2, 3, 4, 5, 6, 0]);
  }, [habit]);

  if (!habit) return null;

  return (
    <div ref={rootRef} className="modal-backdrop" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        className="modal-card task-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-schedule-title"
        onClick={(event) => event.stopPropagation()}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) onSave(encodeCheckinWeekdays(everyDay, days));
          }}
        >
          <h2 id="habit-schedule-title">{habit.title}</h2>
          <label className="field">
            <span>{t("checkin.schedule")}</span>
            <CheckinWeekdayFields
              everyDay={everyDay}
              days={days}
              disabled={busy}
              onEveryDayChange={setEveryDay}
              onDaysChange={setDays}
            />
          </label>
          <p className="task-detail-meta">{t("checkin.scheduleHint")}</p>
          <div className="modal-actions">
            <button type="button" className="secondary-btn" disabled={busy} onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary-btn" disabled={busy}>
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HabitNoteIndicator() {
  return (
    <span className="habit-note-indicator" aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M4 1.5h5l3 3v10H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M9 1.5v3h3M6 8h4M6 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function HabitNoteButton({
  note,
  noteTitle,
  noteDay,
  checkedTitles = [],
  children,
  onClick,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  note: string;
  noteTitle: string;
  noteDay: string;
  checkedTitles?: string[];
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const tooltipId = useId();
  const trimmedNote = note.trim();
  const hasNote = trimmedNote.length > 0;
  const hasChecked = checkedTitles.length > 0;
  const hasDetail = hasNote || hasChecked;
  const visible = open && hasDetail;

  function cancelHide() {
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }

  function hideSoon() {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => () => cancelHide(), []);

  useLayoutEffect(() => {
    if (!visible || !buttonRef.current) return;
    placeAnchoredTaskCard(cardRef.current, buttonRef.current.getBoundingClientRect());
  }, [visible, note, noteTitle, noteDay, checkedTitles]);

  useEffect(() => {
    if (!visible) return;
    const dismiss = () => setOpen(false);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return;
      dismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node &&
        (buttonRef.current?.contains(event.target) || cardRef.current?.contains(event.target))) return;
      dismiss();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [visible]);

  return (
    <>
      <button
        {...props}
        ref={buttonRef}
        title={hasDetail ? undefined : title}
        aria-describedby={visible ? tooltipId : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse" || !hasDetail) return;
          cancelHide();
          setOpen(true);
        }}
        onPointerLeave={hideSoon}
        onFocus={() => {
          if (!hasDetail) return;
          cancelHide();
          setOpen(true);
        }}
        onBlur={() => {
          cancelHide();
          setOpen(false);
        }}
        onClick={(event) => {
          cancelHide();
          setOpen(false);
          onClick?.(event);
        }}
      >
        {children}
      </button>
      {visible && createPortal(
        <div
          ref={cardRef}
          id={tooltipId}
          role="tooltip"
          className="habit-note-tooltip"
          onPointerEnter={cancelHide}
          onPointerLeave={hideSoon}
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{noteTitle}</strong>
          {hasChecked && (
            <>
              <span>{t("checkin.checkedTasks")}</span>
              <ul className="habit-note-checked">
                {checkedTitles.map((titleText) => (
                  <li key={titleText}>{titleText}</li>
                ))}
              </ul>
            </>
          )}
          {hasNote && (
            <>
              <span>{noteDay} · {t("checkin.note")}</span>
              <p>{trimmedNote}</p>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

function HabitMark({
  mark,
  label,
  title,
  note,
  checkedTitles,
  taskTitle,
  day,
  onClick,
}: {
  mark: Mark;
  label: string;
  title?: string;
  note: string;
  checkedTitles: string[];
  taskTitle: string;
  day: Date;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const checked = mark === "checked";
  const hasNote = note.trim().length > 0;
  const hasChecked = checkedTitles.length > 0;
  const detailHint = [
    hasNote ? t("checkin.hasNote") : "",
    hasChecked ? t("checkin.hasCheckedTasks") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <HabitNoteButton
      note={note}
      noteTitle={taskTitle}
      noteDay={dayKey(day)}
      checkedTitles={checkedTitles}
      type="button"
      className={`habit-mark${checked ? " is-checked" : " is-missed"}`}
      aria-label={detailHint ? `${label} · ${detailHint}` : label}
      aria-pressed={checked}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span aria-hidden>{checked ? "✓" : "✗"}</span>
      {(hasNote || hasChecked) && <HabitNoteIndicator />}
    </HabitNoteButton>
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
  detailCheckedTitles,
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
  detailCheckedTitles: (task: Task, day: Date) => string[];
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
                    const checkedTitles = detailCheckedTitles(task, day);
                    const hasNote = note.trim().length > 0;
                    const hasChecked = checkedTitles.length > 0;
                    const status = on
                      ? byClock
                        ? t("checkin.checkedByClock")
                        : t("checkin.checked")
                      : t("checkin.missed");
                    const detailHint = [
                      hasNote ? t("checkin.hasNote") : "",
                      hasChecked ? t("checkin.hasCheckedTasks") : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    const title = [
                      byClock ? t("checkin.clockNote") : "",
                      note,
                      checkedTitles.length
                        ? `${t("checkin.checkedTasks")}: ${checkedTitles.join(
                            locale === "zh" ? "、" : ", ",
                          )}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    return (
                      <li key={task.id}>
                        <HabitNoteButton
                          note={note}
                          noteTitle={task.title}
                          noteDay={dayKey(day)}
                          checkedTitles={checkedTitles}
                          type="button"
                          className="habit-month-item"
                          aria-pressed={on}
                          aria-label={`${task.title}${status}${detailHint ? ` · ${detailHint}` : ""}`}
                          title={title || undefined}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(task, day);
                          }}
                        >
                          <span className="habit-month-title">{task.title}</span>
                          {(hasNote || hasChecked) && <HabitNoteIndicator />}
                          <span
                            className={`habit-glyph${on ? " is-checked" : " is-missed"}`}
                            aria-hidden
                          >
                            {on ? "✓" : "✗"}
                          </span>
                        </HabitNoteButton>
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

function HabitScheduleLabel({ task }: { task: Task }) {
  const { locale } = useI18n();
  const days = parseCheckinWeekdays(task.checkin_weekdays);
  if (!days) return null;
  const labels = [1, 2, 3, 4, 5, 6, 0]
    .filter((day) => days.includes(day))
    .map((day) => WEEKDAY_SHORT[locale][day] ?? "");
  return <span className="habit-week-schedule">{labels.join(locale === "zh" ? "、" : ", ")}</span>;
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
  detailCheckedTitles,
  streaks,
  perfectStreak,
  onOpen,
  onSchedule,
}: {
  days: Date[];
  today: Date;
  habits: Task[];
  markFor: (task: Task, day: Date) => Mark | null;
  checkedByClock: (task: Task, day: Date) => boolean;
  detailNote: (task: Task, day: Date) => string;
  detailCheckedTitles: (task: Task, day: Date) => string[];
  streaks: Map<string, StreakSpan>;
  perfectStreak: StreakSpan;
  onSchedule: (task: Task) => void;
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
          <div className="habit-week-name">
            <button
              type="button"
              className="habit-week-title"
              title={t("checkin.scheduleHint")}
              onClick={() => onSchedule(task)}
            >
              {task.title}
            </button>
            <HabitScheduleLabel task={task} />
          </div>
          <RecordCell current={streak.current} best={streak.best} />
          {days.map((day) => {
            const mark = markFor(task, day);
            const note = detailNote(task, day);
            const checkedTitles = detailCheckedTitles(task, day);
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
                    note={note}
                    checkedTitles={checkedTitles}
                    taskTitle={task.title}
                    day={day}
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
                        note,
                        checkedTitles.length
                          ? `${t("checkin.checkedTasks")}: ${checkedTitles.join(
                              locale === "zh" ? "、" : ", ",
                            )}`
                          : "",
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
