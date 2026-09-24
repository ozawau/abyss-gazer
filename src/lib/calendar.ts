import type { PomodoroSession, Task } from "./api";
import { WEEKDAY_SHORT, type AppLocale } from "./i18n";

/** 与 `Date.getDay()` 一致：0=周日 … 6=周六 */
export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DEFAULT_WEEK_STARTS_ON: WeekStartsOn = 1;

export type CalendarMode = "year" | "month" | "week";

export function normalizeWeekStartsOn(value: number): WeekStartsOn {
  const n = Math.floor(value);
  if (n >= 0 && n <= 6) return n as WeekStartsOn;
  return DEFAULT_WEEK_STARTS_ON;
}

export function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfLocalDay(date: Date): Date {
  const d = startOfLocalDay(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Index of weekday within the configured week: 0 = first day of week. */
export function weekdayIndex(date: Date, weekStartsOn: WeekStartsOn): number {
  return (date.getDay() - weekStartsOn + 7) % 7;
}

export function startOfWeek(
  date: Date,
  weekStartsOn: WeekStartsOn = DEFAULT_WEEK_STARTS_ON,
): Date {
  const d = startOfLocalDay(date);
  return addDays(d, -weekdayIndex(d, weekStartsOn));
}

export function startOfMonth(date: Date): Date {
  return startOfLocalDay(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function weekdayShortLabels(
  weekStartsOn: WeekStartsOn = DEFAULT_WEEK_STARTS_ON,
  locale: AppLocale = "zh",
): string[] {
  const names = WEEKDAY_SHORT[locale];
  return Array.from({ length: 7 }, (_, i) => names[(weekStartsOn + i) % 7]!);
}

export function formatMonthTitle(date: Date, locale: AppLocale = "zh"): string {
  if (locale === "en") {
    return date.toLocaleDateString("en", { month: "long", year: "numeric" });
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatYearTitle(date: Date, locale: AppLocale = "zh"): string {
  if (locale === "en") return String(date.getFullYear());
  return `${date.getFullYear()}年`;
}

export function formatWeekTitle(weekStart: Date, locale: AppLocale = "zh"): string {
  const weekEnd = addDays(weekStart, 6);
  if (locale === "en") {
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
    const start = weekStart.toLocaleDateString("en", { month: "short", day: "numeric" });
    const end = weekEnd.toLocaleDateString("en", {
      month: sameMonth ? undefined : "short",
      day: "numeric",
      year: "numeric",
    });
    return `${start} – ${end}`;
  }
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth();
  if (sameMonth) {
    return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 – ${weekEnd.getDate()}日`;
  }
  return `${weekStart.getFullYear()}年${weekStart.getMonth() + 1}月${weekStart.getDate()}日 – ${weekEnd.getMonth() + 1}月${weekEnd.getDate()}日`;
}

export function formatDayPanelTitle(date: Date, locale: AppLocale = "zh"): string {
  if (locale === "en") {
    return date.toLocaleDateString("en", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const weekday = WEEKDAY_SHORT.zh[date.getDay()] ?? "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 周${weekday}`;
}

export function formatMonthName(monthIndex: number, locale: AppLocale): string {
  if (locale === "en") {
    return new Date(2000, monthIndex, 1).toLocaleDateString("en", { month: "short" });
  }
  return `${monthIndex + 1}月`;
}

export function formatTimeHm(ms: number): string {
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Inclusive local-day span from start_at / due_at. */
export function taskCalendarSpan(
  task: Task,
): { start: Date; end: Date } | null {
  const starts: Date[] = [];
  if (task.start_at != null) starts.push(startOfLocalDay(new Date(task.start_at)));
  if (task.due_at != null) starts.push(startOfLocalDay(new Date(task.due_at)));
  if (starts.length === 0) return null;
  starts.sort((a, b) => a.getTime() - b.getTime());
  return { start: starts[0]!, end: starts[starts.length - 1]! };
}

export function taskIntersectsDay(task: Task, day: Date): boolean {
  const span = taskCalendarSpan(task);
  if (!span) return false;
  const t = startOfLocalDay(day).getTime();
  return t >= span.start.getTime() && t <= span.end.getTime();
}

export function scheduledTasksOnDay(tasks: Task[], day: Date): Task[] {
  return tasks.filter((t) => taskIntersectsDay(t, day));
}

export function taskCompletedOnDay(task: Task, day: Date): boolean {
  if (task.status !== "done") return false;
  const ms = task.completed_at ?? task.updated_at;
  return sameDay(startOfLocalDay(new Date(ms)), startOfLocalDay(day));
}

export function completedTasksOnDay(tasks: Task[], day: Date): Task[] {
  return tasks.filter((t) => taskCompletedOnDay(t, day));
}

/** Scheduled tasks plus tasks marked done on this day (no duplicate ids). */
export function calendarTasksOnDay(tasks: Task[], day: Date): Task[] {
  const completed = completedTasksOnDay(tasks, day);
  const seen = new Set(completed.map((t) => t.id));
  const scheduled = scheduledTasksOnDay(tasks, day).filter((t) => !seen.has(t.id));
  return [...completed, ...scheduled];
}

export function sessionIntersectsDay(session: PomodoroSession, day: Date): boolean {
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = addDays(startOfLocalDay(day), 1).getTime();
  return session.started_at < dayEnd && session.ended_at > dayStart;
}

export function focusSessionsOnDay(
  sessions: PomodoroSession[],
  day: Date,
): PomodoroSession[] {
  return sessions.filter((s) => sessionIntersectsDay(s, day));
}

/** Completed focus sessions that started on this local day. */
export function completedFocusCountOnDay(
  sessions: PomodoroSession[],
  day: Date,
): number {
  const start = startOfLocalDay(day).getTime();
  const end = addDays(startOfLocalDay(day), 1).getTime();
  let count = 0;
  for (const session of sessions) {
    if (session.started_at >= start && session.started_at < end) count += 1;
  }
  return count;
}

/** Clip session to a local calendar day for vertical layout (minutes from midnight). */
export function clipSessionToDay(
  session: PomodoroSession,
  day: Date,
): { startMin: number; endMin: number } | null {
  if (!sessionIntersectsDay(session, day)) return null;
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = addDays(startOfLocalDay(day), 1).getTime();
  const startMs = Math.max(session.started_at, dayStart);
  const endMs = Math.min(session.ended_at, dayEnd);
  if (endMs <= startMs) return null;
  const startMin = (startMs - dayStart) / 60_000;
  const endMin = (endMs - dayStart) / 60_000;
  return { startMin, endMin };
}

export function countDayActivity(
  tasks: Task[],
  sessions: PomodoroSession[],
  day: Date,
): number {
  const listed = calendarTasksOnDay(tasks, day).length;
  const focus = focusSessionsOnDay(sessions, day).length;
  return listed + focus;
}

export function buildMonthGrid(
  anchor: Date,
  weekStartsOn: WeekStartsOn = DEFAULT_WEEK_STARTS_ON,
): Date[] {
  const first = startOfMonth(anchor);
  const gridStart = addDays(first, -weekdayIndex(first, weekStartsOn));
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(addDays(gridStart, i));
  }
  return cells;
}

export function buildWeekDays(
  anchor: Date,
  weekStartsOn: WeekStartsOn = DEFAULT_WEEK_STARTS_ON,
): Date[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function taskMarkerKind(
  task: Task,
  day: Date,
): "start" | "due" | "span" | null {
  if (!taskIntersectsDay(task, day)) return null;
  const start =
    task.start_at != null &&
    sameDay(startOfLocalDay(new Date(task.start_at)), day);
  const due =
    task.due_at != null && sameDay(startOfLocalDay(new Date(task.due_at)), day);
  if (start && due) return "due";
  if (start) return "start";
  if (due) return "due";
  return "span";
}

export function calendarRangeMs(
  mode: CalendarMode,
  cursor: Date,
  weekStartsOn: WeekStartsOn = DEFAULT_WEEK_STARTS_ON,
): { startMs: number; endMs: number } {
  if (mode === "year") {
    const start = startOfLocalDay(new Date(cursor.getFullYear(), 0, 1));
    const end = endOfLocalDay(new Date(cursor.getFullYear(), 11, 31));
    return { startMs: start.getTime(), endMs: end.getTime() + 1 };
  }
  if (mode === "week") {
    const weekStart = startOfWeek(cursor, weekStartsOn);
    const weekEnd = endOfLocalDay(addDays(weekStart, 6));
    return { startMs: weekStart.getTime(), endMs: weekEnd.getTime() + 1 };
  }
  const cells = buildMonthGrid(cursor, weekStartsOn);
  const start = startOfLocalDay(cells[0]!);
  const end = endOfLocalDay(cells[cells.length - 1]!);
  return { startMs: start.getTime(), endMs: end.getTime() + 1 };
}

export const WEEK_HOUR_LABELS = Array.from({ length: 25 }, (_, i) => i);
export const MINUTES_PER_DAY = 24 * 60;

const UNCategorized_COLOR = "#94a3b8";

export function categoryColor(
  categoryId: string | null | undefined,
  categoryMap: Map<string, { color: string }>,
): string {
  if (!categoryId) return UNCategorized_COLOR;
  return categoryMap.get(categoryId)?.color ?? UNCategorized_COLOR;
}
