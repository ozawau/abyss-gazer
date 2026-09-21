import type { PomodoroSession, Task } from "./api";
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
): string {
  if (scale === "month") {
    const start = startOfMonth(cursor);
    return `${start.getFullYear()}年${start.getMonth() + 1}月`;
  }
  if (scale === "quarter") {
    const start = startOfQuarter(cursor);
    const q = Math.floor(start.getMonth() / 3) + 1;
    return `${start.getFullYear()}年 第${q}季度`;
  }
  const { start, end } = range;
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getDate()}日`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
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

export function buildGanttRange(
  scale: GanttScale,
  cursor: Date,
  weekStartsOn: WeekStartsOn,
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
        sublabel: ["日", "一", "二", "三", "四", "五", "六"][dow],
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
        sublabel: ["日", "一", "二", "三", "四", "五", "六"][dow],
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

export interface GanttActivityMark {
  key: string;
  left: number;
  width: number;
  kind: "focus" | "done";
}

function sessionLocalDays(session: PomodoroSession): Date[] {
  const start = startOfLocalDay(new Date(session.started_at));
  const end = startOfLocalDay(
    new Date(Math.max(session.ended_at - 1, session.started_at)),
  );
  const days: Date[] = [];
  for (let day = start; day.getTime() <= end.getTime(); day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

export function ganttActivityMarks(
  task: Task,
  sessions: PomodoroSession[],
  range: GanttRange,
): GanttActivityMark[] {
  const days = new Map<string, Date>();
  for (const session of sessions) {
    if (session.task_id !== task.id) continue;
    for (const day of sessionLocalDays(session)) {
      days.set(dayKey(day), day);
    }
  }
  const doneKey =
    task.status === "done"
      ? dayKey(startOfLocalDay(new Date(task.completed_at ?? task.updated_at)))
      : null;
  if (doneKey && taskCompletedInGanttRange(task, range)) {
    days.set(
      doneKey,
      startOfLocalDay(new Date(task.completed_at ?? task.updated_at)),
    );
  }

  const marks: GanttActivityMark[] = [];
  for (const [key, day] of days) {
    if (day < range.start || day > range.end) continue;
    const startOff = daysBetween(range.start, day);
    marks.push({
      key,
      left: (startOff / range.unitDays) * range.columnWidth,
      width: Math.max((1 / range.unitDays) * range.columnWidth - 4, 6),
      kind: key === doneKey ? "done" : "focus",
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
