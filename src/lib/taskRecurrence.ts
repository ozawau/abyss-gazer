import solarLunar from "solarlunar";
import type { Task } from "./api";
import { spawnRecurringTasks } from "./api";
import { addDays, dayKey, startOfLocalDay } from "./calendar";
import { statutoryDayInfo } from "./cnStatutoryDay";
import { WEEKDAY_FULL, type AppLocale, type MessageKey } from "./i18n";
import { isTaskUpcoming } from "./taskSchedule";
import { taskById } from "./taskTree";

/** Count from the start of the month, or back from the end. */
export type CountDirection = "forward" | "backward";

export type TaskRecurrence =
  | { kind: "daily"; since: string }
  | { kind: "interval"; days: number; since: string }
  | { kind: "weekly"; weekdays: number[]; since: string }
  | { kind: "monthly-day"; direction: CountDirection; days: number[]; since: string }
  | { kind: "monthly-workday"; direction: CountDirection; indexes: number[]; since: string }
  | { kind: "monthly-restday"; direction: CountDirection; indexes: number[]; since: string }
  | { kind: "yearly"; months: number[]; days: number[]; since: string }
  | { kind: "lunar-yearly"; months: number[]; days: number[]; since: string };

export type RecurrenceDraft =
  | { kind: "none" }
  | { kind: "daily" }
  | { kind: "interval"; days: number }
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "monthly-day"; direction: CountDirection; days: number[] }
  | { kind: "monthly-workday"; direction: CountDirection; indexes: number[] }
  | { kind: "monthly-restday"; direction: CountDirection; indexes: number[] }
  | { kind: "yearly"; months: number[]; days: number[] }
  | { kind: "lunar-yearly"; months: number[]; days: number[] };

const LUNAR_MONTHS_ZH = [
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "冬月",
  "腊月",
];

const LOOKBACK_DAYS = 366;

function lunarDayZh(day: number): string {
  const digits = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  if (day <= 10) return `初${digits[day - 1]}`;
  if (day < 20) return `十${digits[day - 11]}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${digits[day - 21]}`;
  return "三十";
}

export function lunarMonthLabel(month: number, locale: AppLocale): string {
  if (locale === "zh") return LUNAR_MONTHS_ZH[month - 1] ?? String(month);
  return `Month ${month}`;
}

export function lunarDayLabel(day: number, locale: AppLocale): string {
  if (locale === "zh") return lunarDayZh(day);
  return `Day ${day}`;
}

function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function parseTaskRecurrence(raw: string | null | undefined): TaskRecurrence | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const since = typeof record.since === "string" && parseDayKey(record.since) ? record.since : "";
  if (record.kind === "daily") return { kind: "daily", since };
  if (record.kind === "interval") {
    const days = readPositiveInt(record.days);
    if (days == null) return null;
    return { kind: "interval", days, since };
  }
  if (record.kind === "weekly") {
    const weekdays = readNumberList(record, "weekdays", "weekday", 0, 6);
    if (!weekdays) return null;
    return { kind: "weekly", weekdays, since };
  }
  if (record.kind === "monthly-day") {
    const days = readNumberList(record, "days", "day", 1, 31);
    if (!days) return null;
    const direction = record.direction === "backward" ? "backward" : "forward";
    return { kind: "monthly-day", direction, days, since };
  }
  if (record.kind === "monthly-workday" || record.kind === "monthly-restday") {
    const counted = readCounted(record);
    if (!counted) return null;
    return { kind: record.kind, ...counted, since };
  }
  if (record.kind === "monthly") {
    if (record.anchor === "first-workday") {
      return { kind: "monthly-workday", direction: "forward", indexes: [1], since };
    }
    if (record.anchor === "last-restday") {
      return { kind: "monthly-restday", direction: "backward", indexes: [1], since };
    }
    return null;
  }
  if (record.kind === "yearly" || record.kind === "lunar-yearly") {
    const maxDay = record.kind === "lunar-yearly" ? 30 : 31;
    const months = readNumberList(record, "months", "month", 1, 12);
    const days = readNumberList(record, "days", "day", 1, maxDay);
    if (!months || !days) return null;
    return record.kind === "yearly"
      ? { kind: "yearly", months, days, since }
      : { kind: "lunar-yearly", months, days, since };
  }
  return null;
}

function readPositiveInt(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return n;
}

export function parseIntervalDays(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  return readPositiveInt(Number(text));
}

function readNumberList(
  record: Record<string, unknown>,
  plural: string,
  singular: string,
  min: number,
  max: number,
): number[] | null {
  const raw = plural in record ? record[plural] : record[singular];
  if (raw == null) return null;
  const values = Array.isArray(raw) ? raw : [raw];
  if (values.length === 0) return null;
  const nums: number[] = [];
  for (const item of values) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < min || n > max) return null;
    if (!nums.includes(n)) nums.push(n);
  }
  nums.sort((a, b) => a - b);
  return nums;
}

function readCounted(
  record: Record<string, unknown>,
): { direction: CountDirection; indexes: number[] } | null {
  if (record.index === "last" && record.indexes == null) {
    return { direction: "backward", indexes: [1] };
  }
  const indexes =
    record.indexes != null
      ? readNumberList(record, "indexes", "indexes", 1, 31)
      : readNumberList(record, "index", "index", 1, 31);
  if (!indexes) return null;
  const direction = record.direction === "backward" ? "backward" : "forward";
  return { direction, indexes };
}

function sameNums(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.every((n, index) => n === b[index]);
}

function listSeparator(locale: AppLocale): string {
  return locale === "zh" ? "、" : ", ";
}

function joinNums(nums: readonly number[], locale: AppLocale): string {
  return [...nums]
    .sort((a, b) => a - b)
    .map(String)
    .join(listSeparator(locale));
}

export function recurrenceDraft(rule: TaskRecurrence | null): RecurrenceDraft {
  if (!rule) return { kind: "none" };
  if (rule.kind === "daily") return { kind: "daily" };
  if (rule.kind === "interval") return { kind: "interval", days: rule.days };
  if (rule.kind === "weekly") return { kind: "weekly", weekdays: rule.weekdays };
  if (rule.kind === "monthly-day") return { kind: "monthly-day", direction: rule.direction, days: rule.days };
  if (rule.kind === "monthly-workday") {
    return { kind: "monthly-workday", direction: rule.direction, indexes: rule.indexes };
  }
  if (rule.kind === "monthly-restday") {
    return { kind: "monthly-restday", direction: rule.direction, indexes: rule.indexes };
  }
  if (rule.kind === "yearly") return { kind: "yearly", months: rule.months, days: rule.days };
  return { kind: "lunar-yearly", months: rule.months, days: rule.days };
}

function sameBody(rule: TaskRecurrence, draft: Exclude<RecurrenceDraft, { kind: "none" }>): boolean {
  if (rule.kind !== draft.kind) return false;
  if (rule.kind === "daily" && draft.kind === "daily") return true;
  if (rule.kind === "interval" && draft.kind === "interval") return rule.days === draft.days;
  if (rule.kind === "weekly" && draft.kind === "weekly") {
    return sameNums(rule.weekdays, draft.weekdays);
  }
  if (rule.kind === "monthly-day" && draft.kind === "monthly-day") {
    return rule.direction === draft.direction && sameNums(rule.days, draft.days);
  }
  if (
    (rule.kind === "monthly-workday" && draft.kind === "monthly-workday") ||
    (rule.kind === "monthly-restday" && draft.kind === "monthly-restday")
  ) {
    return rule.direction === draft.direction && sameNums(rule.indexes, draft.indexes);
  }
  if (
    (rule.kind === "yearly" && draft.kind === "yearly") ||
    (rule.kind === "lunar-yearly" && draft.kind === "lunar-yearly")
  ) {
    return sameNums(rule.months, draft.months) && sameNums(rule.days, draft.days);
  }
  return false;
}

/** Keep the original start day when the rule itself did not change. */
export function stampRecurrence(
  previousRaw: string | null | undefined,
  draft: RecurrenceDraft,
  today = new Date(),
): string | null {
  if (draft.kind === "none") return null;
  const previous = parseTaskRecurrence(previousRaw);
  const since =
    previous && previous.since && sameBody(previous, draft) ? previous.since : dayKey(today);
  if (draft.kind === "daily") {
    return JSON.stringify({ kind: "daily", since });
  }
  if (draft.kind === "interval") {
    return JSON.stringify({ kind: "interval", days: draft.days, since });
  }
  if (draft.kind === "weekly") {
    return JSON.stringify({ kind: "weekly", weekdays: [...draft.weekdays].sort((a, b) => a - b), since });
  }
  if (draft.kind === "monthly-day") {
    return JSON.stringify({ kind: "monthly-day", direction: draft.direction, days: [...draft.days].sort((a, b) => a - b), since });
  }
  if (draft.kind === "monthly-workday" || draft.kind === "monthly-restday") {
    return JSON.stringify({
      kind: draft.kind,
      direction: draft.direction,
      indexes: [...draft.indexes].sort((a, b) => a - b),
      since,
    });
  }
  return JSON.stringify({
    kind: draft.kind,
    months: [...draft.months].sort((a, b) => a - b),
    days: [...draft.days].sort((a, b) => a - b),
    since,
  });
}

export function recurrenceLabel(
  rule: TaskRecurrence,
  locale: AppLocale,
  t: (key: MessageKey, vars?: Record<string, string | number>) => string,
): string {
  if (rule.kind === "daily") return t("tasks.repeatDaily");
  if (rule.kind === "interval") return t("tasks.repeatInterval", { days: rule.days });
  if (rule.kind === "weekly") {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const weekday = [...rule.weekdays]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((day) => WEEKDAY_FULL[locale][day] ?? "")
      .filter(Boolean)
      .join(listSeparator(locale));
    return t("tasks.repeatWeekly", { weekday });
  }
  if (rule.kind === "monthly-day") {
    return t(rule.direction === "backward" ? "tasks.repeatMonthlyDayFromEnd" : "tasks.repeatMonthlyDay", { day: joinNums(rule.days, locale) });
  }
  if (rule.kind === "monthly-workday") {
    const n = joinNums(rule.indexes, locale);
    return rule.direction === "backward"
      ? t("tasks.repeatNthWorkdayFromEnd", { n })
      : t("tasks.repeatNthWorkday", { n });
  }
  if (rule.kind === "monthly-restday") {
    const n = joinNums(rule.indexes, locale);
    return rule.direction === "backward"
      ? t("tasks.repeatNthRestdayFromEnd", { n })
      : t("tasks.repeatNthRestday", { n });
  }
  if (rule.kind === "yearly") {
    return t("tasks.repeatYearly", {
      month: joinNums(rule.months, locale),
      day: joinNums(rule.days, locale),
    });
  }
  const sep = listSeparator(locale);
  return t("tasks.repeatLunar", {
    month: rule.months.map((month) => lunarMonthLabel(month, locale)).join(sep),
    day: rule.days.map((day) => lunarDayLabel(day, locale)).join(sep),
  });
}

export function isRestDay(date: Date): boolean {
  const info = statutoryDayInfo(date);
  if (info?.mark === "holiday") return true;
  if (info?.mark === "adjusted-workday") return false;
  const weekday = date.getDay();
  return weekday === 0 || weekday === 6;
}

export function isWorkday(date: Date): boolean {
  return !isRestDay(date);
}

function matchesOrdinal(
  date: Date,
  matches: (day: Date) => boolean,
  direction: CountDirection,
  index: number,
): boolean {
  if (!matches(date)) return false;
  const year = date.getFullYear();
  const month = date.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  let seen = 0;
  if (direction === "backward") {
    for (let day = last; day >= date.getDate(); day -= 1) {
      if (matches(new Date(year, month, day))) seen += 1;
    }
  } else {
    for (let day = 1; day <= date.getDate(); day += 1) {
      if (matches(new Date(year, month, day))) seen += 1;
    }
  }
  return seen === index;
}

function lunarOf(date: Date): { month: number; day: number; leap: boolean } | null {
  const result = solarLunar.solar2lunar(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (result === -1) return null;
  const month = Number(result.lMonth);
  const day = Number(result.lDay);
  if (!Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { month, day, leap: Boolean(result.isLeap) };
}

export function isRecurrenceTemplate(task: { recurrence: string | null }): boolean {
  return parseTaskRecurrence(task.recurrence) != null;
}

export function isInTemplateTree(task: Task, byId: Map<string, Task>): boolean {
  let current: Task | undefined = task;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (isRecurrenceTemplate(current)) return true;
    seen.add(current.id);
    if (!current.parent_id) return false;
    current = byId.get(current.parent_id);
  }
  return false;
}

export function latestInstanceCreatedAt(templateId: string, tasks: readonly Task[]): number | null {
  let latest: number | null = null;
  for (const task of tasks) {
    if (task.recurrence_source_id !== templateId) continue;
    if (latest == null || task.created_at > latest) latest = task.created_at;
  }
  return latest;
}

function latestInstanceOccurrence(templateId: string, tasks: readonly Task[]): Date | null {
  let latestKey: string | null = null;
  for (const task of tasks) {
    const occurrence = task.recurrence_source_id === templateId ? task.recurrence_occurrence : null;
    if (!occurrence) continue;
    if (latestKey == null || occurrence > latestKey) latestKey = occurrence;
  }
  return latestKey ? parseDayKey(latestKey) : null;
}

function daySpan(from: Date, to: Date): number {
  const start = startOfLocalDay(from).getTime();
  const end = startOfLocalDay(to).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function recurrenceMatches(rule: TaskRecurrence, date: Date): boolean {
  if (rule.kind === "daily") return true;
  if (rule.kind === "interval") {
    const start = parseDayKey(rule.since);
    if (!start) return false;
    const span = daySpan(start, date);
    return span >= 0 && span % (rule.days + 1) === 0;
  }
  if (rule.kind === "weekly") return rule.weekdays.includes(date.getDay());
  if (rule.kind === "monthly-day") {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const day = rule.direction === "backward" ? lastDay - date.getDate() + 1 : date.getDate();
    return rule.days.includes(day);
  }
  if (rule.kind === "monthly-workday") {
    return rule.indexes.some((index) => matchesOrdinal(date, isWorkday, rule.direction, index));
  }
  if (rule.kind === "monthly-restday") {
    return rule.indexes.some((index) => matchesOrdinal(date, isRestDay, rule.direction, index));
  }
  if (rule.kind === "yearly") {
    return rule.months.includes(date.getMonth() + 1) && rule.days.includes(date.getDate());
  }
  const lunar = lunarOf(date);
  return (
    !!lunar &&
    !lunar.leap &&
    rule.months.includes(lunar.month) &&
    rule.days.includes(lunar.day)
  );
}

export type CalendarPlanKind = "start" | "recurrence";

/** Future start days, and recurrence hits that do not already have an instance. */
export function calendarPlansOnDay(
  tasks: readonly Task[],
  day: Date,
  now = new Date(),
): { task: Task; kind: CalendarPlanKind }[] {
  const dayStart = startOfLocalDay(day);
  const todayStart = startOfLocalDay(now);
  const occurrence = dayKey(dayStart);
  const byId = taskById([...tasks]);
  const result: { task: Task; kind: CalendarPlanKind }[] = [];
  const seen = new Set<string>();

  if (dayStart.getTime() >= todayStart.getTime()) {
    const taken = new Set(
      tasks
        .filter(
          (task) =>
            task.recurrence_source_id && task.recurrence_occurrence === occurrence,
        )
        .map((task) => task.recurrence_source_id as string),
    );
    for (const task of tasks) {
      const rule = parseTaskRecurrence(task.recurrence);
      if (!rule || taken.has(task.id)) continue;
      const since = parseDayKey(rule.since);
      if (since && dayStart.getTime() < startOfLocalDay(since).getTime()) continue;
      if (!recurrenceMatches(rule, dayStart)) continue;
      seen.add(task.id);
      result.push({ task, kind: "recurrence" });
    }
  }

  const nowMs = now.getTime();
  for (const task of tasks) {
    if (seen.has(task.id) || isInTemplateTree(task, byId)) continue;
    if (!isTaskUpcoming(task, nowMs) || task.start_at == null) continue;
    if (dayKey(startOfLocalDay(new Date(task.start_at))) !== occurrence) continue;
    seen.add(task.id);
    result.push({ task, kind: "start" });
  }
  return result;
}

export async function materializeRecurringTasks(
  tasks: Task[],
  settled: ReadonlySet<string>,
  today = new Date(),
): Promise<{ created: Task[]; settled: string[] }> {
  const taken = new Set(
    tasks
      .filter((task) => task.recurrence_source_id && task.recurrence_occurrence)
      .map((task) => `${task.recurrence_source_id}:${task.recurrence_occurrence}`),
  );
  const end = startOfLocalDay(today);
  const floor = startOfLocalDay(addDays(end, -LOOKBACK_DAYS));
  const items: { template_id: string; occurrence: string; start_at: number }[] = [];
  for (const task of tasks) {
    const rule = parseTaskRecurrence(task.recurrence);
    if (!rule) continue;
    const since = parseDayKey(rule.since);
    let cursor = since ? startOfLocalDay(since) : end;
    const latestOccurrence = latestInstanceOccurrence(task.id, tasks);
    if (latestOccurrence) {
      const nextDay = startOfLocalDay(addDays(latestOccurrence, 1));
      if (nextDay.getTime() > cursor.getTime()) cursor = nextDay;
    }
    if (cursor.getTime() < floor.getTime()) cursor = floor;
    for (let date = cursor; date.getTime() <= end.getTime(); date = addDays(date, 1)) {
      if (!recurrenceMatches(rule, date)) continue;
      const occurrence = dayKey(date);
      const key = `${task.id}:${occurrence}`;
      if (taken.has(key) || settled.has(key)) continue;
      items.push({
        template_id: task.id,
        occurrence,
        start_at: startOfLocalDay(date).getTime(),
      });
      taken.add(key);
    }
  }
  if (items.length === 0) return { created: [], settled: [] };
  return spawnRecurringTasks(items);
}
