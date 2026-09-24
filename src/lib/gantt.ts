import type { PomodoroSession, Task } from "./api";
import { WEEKDAY_SHORT, type AppLocale } from "./i18n";
import { descendantIds, taskById } from "./taskTree";
import {
  addDays,
  addMonths,
  dayKey,
  endOfLocalDay,
  sameDay,
  startOfLocalDay,
  startOfMonth,
  startOfWeek,
  taskCalendarSpan,
  type WeekStartsOn,
} from "./calendar";

export type GanttScale = "week" | "month" | "quarter";
export type GanttActivityMode = "discrete" | "continuous";

function hashTaskId(taskId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < taskId.length; i++) {
    hash ^= taskId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Stable, visually distinct color for a Gantt task. */
export function ganttTaskColor(taskId: string): string {
  const hash = hashTaskId(taskId);
  const hue = Math.round((hash * 137.508) % 360);
  const sat = 54 + (hash % 22);
  const light = 40 + ((hash >>> 9) % 12);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export interface GanttColumn {
  start: Date;
  key: string;
  label: string;
  sublabel?: string;
  isWeekend: boolean;
}

export interface GanttRange {
  start: Date;
  /** Inclusive last local day in the visible range. */
  end: Date;
  unitDays: number;
  columnWidth: number;
  columns: GanttColumn[];
}

export const GANTT_DAY_COL_PX = 42;
export const GANTT_WEEK_COL_PX = 72;

export function daysBetween(a: Date, b: Date): number {
  const sa = startOfLocalDay(a).getTime();
  const sb = startOfLocalDay(b).getTime();
  return Math.round((sb - sa) / 86_400_000);
}

export function startOfQuarter(date: Date): Date {
  const month = date.getMonth();
  const q = Math.floor(month / 3) * 3;
  return startOfLocalDay(new Date(date.getFullYear(), q, 1));
}

export function formatGanttTitle(
  scale: GanttScale,
  range: GanttRange,
  cursor: Date,
  locale: AppLocale = "zh",
): string {
  if (scale === "month") return formatMonthSpan(startOfMonth(cursor), locale);
  if (scale === "quarter") {
    const start = startOfQuarter(cursor);
    const q = Math.floor(start.getMonth() / 3) + 1;
    if (locale === "en") return `Q${q} ${start.getFullYear()}`;
    return `${start.getFullYear()}年 第${q}季度`;
  }
  return formatGanttSpan(range, locale);
}

function formatMonthSpan(start: Date, locale: AppLocale): string {
  if (locale === "en") {
    return start.toLocaleDateString("en", { month: "long", year: "numeric" });
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月`;
}

/** Title for an arbitrary inclusive day range. */
export function formatGanttSpan(range: GanttRange, locale: AppLocale = "zh"): string {
  const { start, end } = range;
  if (locale === "en") {
    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    const startText = start.toLocaleDateString("en", {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
    const endText = end.toLocaleDateString("en", {
      month: sameMonth ? undefined : "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startText} – ${endText}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getDate()}日`;
  }
  if (sameYear) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
}

export function ganttColumnIsToday(
  col: GanttColumn,
  today: Date,
  unitDays: number,
): boolean {
  if (unitDays > 1) {
    const weekEnd = addDays(col.start, unitDays - 1);
    const t = startOfLocalDay(today).getTime();
    return (
      t >= startOfLocalDay(col.start).getTime() &&
      t <= startOfLocalDay(weekEnd).getTime()
    );
  }
  return sameDay(col.start, today);
}

function weekdayMark(dow: number, locale: AppLocale): string {
  return WEEKDAY_SHORT[locale][dow] ?? "";
}

export function buildGanttRange(
  scale: GanttScale,
  cursor: Date,
  weekStartsOn: WeekStartsOn,
  locale: AppLocale = "zh",
): GanttRange {
  if (scale === "week") {
    const start = startOfWeek(cursor, weekStartsOn);
    const columns: GanttColumn[] = Array.from({ length: 14 }, (_, i) => {
      const day = addDays(start, i);
      const dow = day.getDay();
      return {
        start: day,
        key: dayKey(day),
        label: `${day.getMonth() + 1}/${day.getDate()}`,
        sublabel: weekdayMark(dow, locale),
        isWeekend: dow === 0 || dow === 6,
      };
    });
    return {
      start,
      end: addDays(start, 13),
      unitDays: 1,
      columnWidth: GANTT_DAY_COL_PX,
      columns,
    };
  }

  if (scale === "month") {
    const start = startOfMonth(cursor);
    const next = addMonths(start, 1);
    const count = daysBetween(start, next);
    const columns: GanttColumn[] = Array.from({ length: count }, (_, i) => {
      const day = addDays(start, i);
      const dow = day.getDay();
      return {
        start: day,
        key: dayKey(day),
        label: String(day.getDate()),
        sublabel: weekdayMark(dow, locale),
        isWeekend: dow === 0 || dow === 6,
      };
    });
    return {
      start,
      end: addDays(next, -1),
      unitDays: 1,
      columnWidth: GANTT_DAY_COL_PX,
      columns,
    };
  }

  const quarterStart = startOfQuarter(cursor);
  const quarterEnd = addDays(addMonths(quarterStart, 3), -1);
  const gridStart = startOfWeek(quarterStart, weekStartsOn);
  const columns: GanttColumn[] = [];
  for (let week = gridStart; week <= quarterEnd; week = addDays(week, 7)) {
    const weekEnd = addDays(week, 6);
    columns.push({
      start: week,
      key: dayKey(week),
      label: `${week.getMonth() + 1}/${week.getDate()}`,
      sublabel: `–${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`,
      isWeekend: false,
    });
  }
  const last = columns[columns.length - 1]!;
  return {
    start: gridStart,
    end: addDays(last.start, 6),
    unitDays: 7,
    columnWidth: GANTT_WEEK_COL_PX,
    columns,
  };
}

/** One column per local day from `start` through `end`, inclusive. */
export function buildGanttDayRange(
  start: Date,
  end: Date,
  locale: AppLocale = "zh",
): GanttRange {
  const from = startOfLocalDay(start);
  const to = startOfLocalDay(end);
  const rangeStart = from <= to ? from : to;
  const rangeEnd = from <= to ? to : from;
  const count = daysBetween(rangeStart, rangeEnd) + 1;
  const columns: GanttColumn[] = Array.from({ length: count }, (_, i) => {
    const day = addDays(rangeStart, i);
    const dow = day.getDay();
    return {
      start: day,
      key: dayKey(day),
      label: `${day.getMonth() + 1}/${day.getDate()}`,
      sublabel: weekdayMark(dow, locale),
      isWeekend: dow === 0 || dow === 6,
    };
  });
  return {
    start: rangeStart,
    end: rangeEnd,
    unitDays: 1,
    columnWidth: GANTT_DAY_COL_PX,
    columns,
  };
}

/** Inclusive local-day range as `[startMs, endMs)` for session queries. */
export function ganttRangeQueryMs(range: GanttRange): {
  startMs: number;
  endMs: number;
} {
  return {
    startMs: startOfLocalDay(range.start).getTime(),
    endMs: endOfLocalDay(range.end).getTime() + 1,
  };
}

export function taskCompletedInGanttRange(task: Task, range: GanttRange): boolean {
  if (task.status !== "done") return false;
  const day = startOfLocalDay(new Date(task.completed_at ?? task.updated_at));
  return day.getTime() >= range.start.getTime() && day.getTime() <= range.end.getTime();
}

export function taskVisibleOnGantt(
  task: Task,
  range: GanttRange,
  sessionTaskIds: Set<string>,
): boolean {
  if (ganttBarLayout(task, range) != null) return true;
  if (taskCompletedInGanttRange(task, range)) return true;
  return sessionTaskIds.has(task.id);
}

export interface GanttContinuousBarLayout {
  left: number;
  width: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

export function ganttContinuousBarLayout(
  task: Task,
  range: GanttRange,
  firstFocusStarts: ReadonlyMap<string, number>,
  today: Date = startOfLocalDay(new Date()),
  sessions: readonly PomodoroSession[] = [],
): GanttContinuousBarLayout | null {
  let focusStart = firstFocusStarts.get(task.id);
  if (focusStart == null) {
    for (const session of sessions) {
      if (session.task_id !== task.id || session.kind !== "focus" || !session.completed) {
        continue;
      }
      if (focusStart == null || session.started_at < focusStart) {
        focusStart = session.started_at;
      }
    }
  }
  const startMs = task.start_at ?? focusStart;
  const todayDay = startOfLocalDay(today);

  let start: Date;
  let end: Date;
  if (task.status === "done") {
    const completionMs = task.completed_at ?? task.updated_at;
    start = startOfLocalDay(new Date(startMs ?? completionMs));
    end = startOfLocalDay(new Date(completionMs));
  } else {
    if (startMs == null) return null;
    start = startOfLocalDay(new Date(startMs));
    end = todayDay;
  }
  if (end < start) end = start;
  if (end < range.start || start > range.end) return null;

  const clipStart = start < range.start ? range.start : start;
  const clipEnd = end > range.end ? range.end : end;
  const startOff = daysBetween(range.start, clipStart);
  const inclusiveDays = daysBetween(clipStart, clipEnd) + 1;
  return {
    left: (startOff / range.unitDays) * range.columnWidth,
    width: (inclusiveDays / range.unitDays) * range.columnWidth,
    clippedStart: start < range.start,
    clippedEnd: end > range.end,
  };
}

function earliestActivityMs(task: Task, sessions: PomodoroSession[]): number {
  let min: number | null = null;
  const span = taskCalendarSpan(task);
  if (span) min = span.start.getTime();
  if (task.status === "done") {
    const completed = task.completed_at ?? task.updated_at;
    if (min == null || completed < min) min = completed;
  }
  for (const session of sessions) {
    if (session.task_id !== task.id) continue;
    if (min == null || session.started_at < min) min = session.started_at;
  }
  return min ?? task.created_at;
}

export function sortGanttTasks(
  tasks: Task[],
  sessions: PomodoroSession[] = [],
): Task[] {
  return [...tasks].sort((a, b) => {
    const at = earliestActivityMs(a, sessions);
    const bt = earliestActivityMs(b, sessions);
    if (at !== bt) return at - bt;
    return a.sort_order - b.sort_order;
  });
}

export interface GanttParentRow {
  parent: Task;
  items: Task[];
}

export function ganttItemsForParent(parent: Task, tasks: Task[]): Task[] {
  const ids = descendantIds(parent.id, tasks);
  if (ids.length === 0) return [parent];
  const byId = taskById(tasks);
  return ids
    .map((id) => byId.get(id))
    .filter((task): task is Task => task != null);
}

export function ganttParentRows(tasks: Task[]): GanttParentRow[] {
  return tasks
    .filter((task) => !task.parent_id)
    .map((parent) => ({
      parent,
      items: ganttItemsForParent(parent, tasks),
    }));
}

function doneRank(status: Task["status"]): number {
  return status === "done" ? 1 : 0;
}

export function sortGanttParentRows(
  rows: GanttParentRow[],
  sessions: PomodoroSession[] = [],
): GanttParentRow[] {
  const ordered = rows.map((row) => ({
    ...row,
    items: [...row.items].sort((a, b) => doneRank(a.status) - doneRank(b.status)),
  }));
  return ordered.sort((a, b) => {
    const rank = doneRank(a.parent.status) - doneRank(b.parent.status);
    if (rank !== 0) return rank;
    const at = Math.min(
      ...a.items.map((item) => earliestActivityMs(item, sessions)),
    );
    const bt = Math.min(
      ...b.items.map((item) => earliestActivityMs(item, sessions)),
    );
    if (at !== bt) return at - bt;
    return a.parent.sort_order - b.parent.sort_order;
  });
}

export interface GanttActivityMark {
  key: string;
  left: number;
  width: number;
  kind: "focus" | "done";
  count: number;
}

export function ganttActivityMarks(
  task: Task,
  sessions: PomodoroSession[],
  range: GanttRange,
): GanttActivityMark[] {
  const days = new Map<string, { day: Date; count: number }>();
  for (const session of sessions) {
    if (session.task_id !== task.id) continue;
    const day = startOfLocalDay(new Date(session.started_at));
    const key = dayKey(day);
    const credit = session.credit ?? 1;
    const prev = days.get(key);
    if (prev) prev.count += credit;
    else days.set(key, { day, count: credit });
  }
  const doneKey =
    task.status === "done"
      ? dayKey(startOfLocalDay(new Date(task.completed_at ?? task.updated_at)))
      : null;
  if (doneKey && taskCompletedInGanttRange(task, range) && !days.has(doneKey)) {
    days.set(doneKey, {
      day: startOfLocalDay(new Date(task.completed_at ?? task.updated_at)),
      count: 0,
    });
  }

  const marks: GanttActivityMark[] = [];
  for (const [key, { day, count }] of days) {
    if (day < range.start || day > range.end) continue;
    const startOff = daysBetween(range.start, day);
    marks.push({
      key,
      left: (startOff / range.unitDays) * range.columnWidth,
      width: Math.max((1 / range.unitDays) * range.columnWidth - 4, 6),
      kind: key === doneKey ? "done" : "focus",
      count,
    });
  }
  marks.sort((a, b) => a.left - b.left);
  return marks;
}

export function ganttBarLayout(
  task: Task,
  range: GanttRange,
): { left: number; width: number; clippedStart: boolean; clippedEnd: boolean } | null {
  const span = taskCalendarSpan(task);
  if (!span) return null;
  if (span.end < range.start || span.start > range.end) return null;

  const clipStart = span.start < range.start ? range.start : span.start;
  const clipEnd = span.end > range.end ? range.end : span.end;
  const startOff = daysBetween(range.start, clipStart);
  const inclusiveDays = daysBetween(clipStart, clipEnd) + 1;
  const left = (startOff / range.unitDays) * range.columnWidth;
  const width = Math.max(
    (inclusiveDays / range.unitDays) * range.columnWidth - 4,
    8,
  );
  return {
    left,
    width,
    clippedStart: span.start < range.start,
    clippedEnd: span.end > range.end,
  };
}

export function todayOffsetPx(range: GanttRange, today: Date): number | null {
  if (today < range.start || today > range.end) return null;
  const off = daysBetween(range.start, today);
  return (off / range.unitDays) * range.columnWidth;
}
