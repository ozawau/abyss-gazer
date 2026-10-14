import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../components/LocaleProvider";
import {
  Category,
  listCategories,
  listHabitCheckins,
  listPomodoroSessionsInRange,
  PomodoroSession,
  SystemSettings,
  Task,
} from "../lib/api";
import { addDays, completedFocusCountOnDay, dayKey, startOfLocalDay } from "../lib/calendar";
import { habitScheduledOn } from "../lib/checkinSchedule";
import { descendantIds } from "../lib/taskTree";

type RangeKey = "7d" | "30d" | "90d" | "all";

interface StatisticsViewProps {
  tasks: Task[];
  systemSettings: SystemSettings;
  dataEpoch: number;
}

interface DayPoint {
  key: string;
  label: string;
  created: number;
  completed: number;
  focusMinutes: number;
  focusPomodoros: number;
}

interface HabitStat {
  id: string;
  title: string;
  checked: number;
  applicable: number;
  rate: number;
}

interface BarTooltip {
  chart: "tasks" | "focus";
  key: string;
  label: string;
  title: string;
  value: string;
  secondary?: string;
}

function rangeStart(key: RangeKey, today: Date, tasks: Task[]): Date {
  if (key === "all") {
    const first = tasks.reduce((min, task) => Math.min(min, task.created_at), today.getTime());
    return startOfLocalDay(new Date(first));
  }
  const days = key === "7d" ? 6 : key === "30d" ? 29 : 89;
  return startOfLocalDay(addDays(today, -days));
}

function formatDay(date: Date, locale: string): string {
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en", {
    month: "numeric",
    day: "numeric",
  });
}

function shortMinutes(minutes: number, t: (key: any, vars?: any) => string): string {
  if (minutes < 60) return `${Math.round(minutes)} ${t("statistics.minutes")}`;
  return `${(minutes / 60).toFixed(minutes >= 600 ? 0 : 1)} ${t("statistics.hours")}`;
}

function ChartEmpty({ label }: { label: string }) {
  return <p className="statistics-empty">{label}</p>;
}

/** Days between two shown labels. 1 keeps every day; 2 shows every other day. */
function axisLabelStep(count: number, chartWidth: number, labelWidth: number): number {
  if (count <= 1 || chartWidth <= 0) return 1;
  const slot = chartWidth / count;
  if (slot >= labelWidth) return 1;
  return Math.ceil(labelWidth / slot);
}

function axisLabelIndexes(count: number, step: number): number[] {
  if (count <= 0) return [];
  const indexes: number[] = [];
  for (let index = 0; index < count; index += step) indexes.push(index);
  const last = count - 1;
  const previous = indexes[indexes.length - 1];
  if (previous !== last) {
    if (last - previous < step) indexes.pop();
    indexes.push(last);
  }
  return indexes;
}

function useChartAxisLabels(count: number, labels: string[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number[]>(() => axisLabelIndexes(count, count <= 14 ? 1 : Math.ceil(count / 12)));

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let canvas: HTMLCanvasElement | null = null;
    const update = () => {
      const style = getComputedStyle(node);
      const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (width <= 0) return;
      const probe = node.querySelector("small");
      const font = probe ? getComputedStyle(probe).font : "10px sans-serif";
      canvas ??= document.createElement("canvas");
      const context = canvas.getContext("2d");
      let labelWidth = 32;
      if (context) {
        context.font = font;
        for (const label of labels) labelWidth = Math.max(labelWidth, context.measureText(label).width);
      }
      const next = axisLabelIndexes(count, axisLabelStep(count, width, labelWidth + 8));
      setShown((current) => (current.length === next.length && current.every((value, index) => value === next[index]) ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [count, labels]);

  const visible = useMemo(() => new Set(shown), [shown]);
  return { ref, visible };
}

export function StatisticsView({ tasks, systemSettings, dataEpoch }: StatisticsViewProps) {
  const { locale, t } = useI18n();
  const [range, setRange] = useState<RangeKey>("30d");
  const [categoryId, setCategoryId] = useState("all");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);
  const [checkins, setCheckins] = useState<Set<string>>(new Set());
  const [barTooltip, setBarTooltip] = useState<BarTooltip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const start = useMemo(() => rangeStart(range, today, tasks), [range, today, tasks]);
  const end = useMemo(() => addDays(today, 1), [today]);
  const startMs = start.getTime();
  const endMs = end.getTime();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      listCategories(),
      listPomodoroSessionsInRange(startMs, endMs),
      listHabitCheckins(dayKey(start), dayKey(today)),
    ])
      .then(([nextCategories, nextSessions, nextCheckins]) => {
        if (cancelled) return;
        setCategories(nextCategories);
        setCategoriesLoaded(true);
        setSessions(nextSessions);
        setCheckins(new Set(nextCheckins.map((row) => `${row.task_id}|${row.day}`)));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [startMs, endMs, dataEpoch, start, today]);

  const categoryMap = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const visibleTasks = useMemo(
    () => tasks.filter((task) => categoryId === "all" || (categoryId === "none" ? !task.category_id : task.category_id === categoryId)),
    [tasks, categoryId],
  );
  // Category breakdown is a period report, so only tasks that were created or
  // completed during the selected range participate in it. This keeps the
  // chart responsive when switching between 7/30/90-day and all-time views.
  const categoryTasks = useMemo(
    () => visibleTasks.filter((task) => {
      const createdInRange = task.created_at >= startMs && task.created_at < endMs;
      const completedInRange = task.completed_at != null && task.completed_at >= startMs && task.completed_at < endMs;
      return createdInRange || completedInRange;
    }),
    [endMs, startMs, visibleTasks],
  );
  const visibleTaskIds = useMemo(() => new Set(visibleTasks.map((task) => task.id)), [visibleTasks]);
  const visibleSessions = useMemo(() => sessions.filter((session) => visibleTaskIds.has(session.task_id)), [sessions, visibleTaskIds]);

  // The check-in page treats a completed focus session on a habit or any of
  // its descendants as an automatic check-in. Keep the statistics page on
  // the same effective-day basis instead of counting manual rows only.
  const autoCheckins = useMemo(() => {
    const habitIds = new Set(visibleTasks.filter((task) => !task.parent_id && task.category_id === systemSettings.checkinCategoryId).map((task) => task.id));
    const habitOfChild = new Map<string, string>();
    for (const habitId of habitIds) {
      habitOfChild.set(habitId, habitId);
      for (const childId of descendantIds(habitId, tasks)) habitOfChild.set(childId, habitId);
    }
    const keys = new Set<string>();
    for (const session of visibleSessions) {
      if (session.kind !== "focus" || !session.completed) continue;
      const habitId = habitOfChild.get(session.task_id);
      if (habitId) keys.add(`${habitId}|${dayKey(new Date(session.started_at))}`);
    }
    return keys;
  }, [systemSettings.checkinCategoryId, tasks, visibleSessions, visibleTasks]);

  const days = useMemo<DayPoint[]>(() => {
    const points: DayPoint[] = [];
    for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
      const key = dayKey(cursor);
      points.push({
        key,
        label: formatDay(cursor, locale),
        created: visibleTasks.filter((task) => dayKey(new Date(task.created_at)) === key).length,
        completed: visibleTasks.filter((task) => task.completed_at != null && dayKey(new Date(task.completed_at)) === key).length,
        focusMinutes: visibleSessions
          .filter((session) => dayKey(new Date(session.started_at)) === key && session.kind === "focus" && session.completed)
          .reduce((sum, session) => sum + (session.planned_seconds * (session.credit ?? 1)) / 60, 0),
        focusPomodoros: completedFocusCountOnDay(visibleSessions, cursor),
      });
    }
    return points;
  }, [end, locale, start, visibleSessions, visibleTasks]);

  const summary = useMemo(() => {
    const created = visibleTasks.filter((task) => task.created_at >= startMs && task.created_at < endMs).length;
    const completed = visibleTasks.filter((task) => task.completed_at != null && task.completed_at >= startMs && task.completed_at < endMs).length;
    const open = visibleTasks.filter((task) => task.status !== "done").length;
    const focusMinutes = visibleSessions
      .filter((session) => session.kind === "focus" && session.completed)
      .reduce((sum, session) => sum + (session.planned_seconds * (session.credit ?? 1)) / 60, 0);
    const habit = visibleTasks.filter((task) => !task.parent_id && task.category_id === systemSettings.checkinCategoryId);
    let applicable = 0;
    let checked = 0;
    for (const task of habit) {
      const habitStart = Math.max(startMs, startOfLocalDay(new Date(task.created_at)).getTime());
      for (let cursor = startOfLocalDay(new Date(habitStart)); cursor < end && cursor <= today; cursor = addDays(cursor, 1)) {
        if (!habitScheduledOn(task.checkin_weekdays, cursor)) continue;
        applicable += 1;
        if (checkins.has(`${task.id}|${dayKey(cursor)}`) || autoCheckins.has(`${task.id}|${dayKey(cursor)}`)) checked += 1;
      }
    }
    const focusPomodoros = visibleSessions.filter(
      (session) => session.started_at >= startMs && session.started_at < endMs,
    ).length;
    return { created, completed, open, focusMinutes, focusPomodoros, completionRate: created ? completed / created : 0, checked, applicable, checkinRate: applicable ? checked / applicable : 0 };
  }, [autoCheckins, checkins, end, endMs, startMs, systemSettings.checkinCategoryId, today, visibleSessions, visibleTasks]);

  const categoryStats = useMemo(() => {
    if (!categoriesLoaded) return [];
    const rows = new Map<string, { name: string; done: number; open: number }>();
    for (const task of categoryTasks) {
      // Missing category references are also uncategorized. Merge them with
      // genuinely null category ids so one logical bucket is shown.
      const category = task.category_id ? categoryMap.get(task.category_id) : undefined;
      const id = category?.id ?? "none";
      const row = rows.get(id) ?? { name: category?.name ?? t("statistics.uncategorized"), done: 0, open: 0 };
      if (task.status === "done") row.done += 1;
      else row.open += 1;
      rows.set(id, row);
    }
    return [...rows.values()].sort((a, b) => b.done + b.open - (a.done + a.open));
  }, [categoriesLoaded, categoryMap, categoryTasks, t]);

  const habitStats = useMemo<HabitStat[]>(() => {
    const habits = visibleTasks.filter((task) => !task.parent_id && task.category_id === systemSettings.checkinCategoryId);
    return habits.map((habit) => {
      const habitStart = Math.max(startMs, startOfLocalDay(new Date(habit.created_at)).getTime());
      let applicable = 0;
      let checked = 0;
      const family = new Set([habit.id, ...descendantIds(habit.id, tasks)]);
      for (let cursor = startOfLocalDay(new Date(habitStart)); cursor < end && cursor <= today; cursor = addDays(cursor, 1)) {
        if (!habitScheduledOn(habit.checkin_weekdays, cursor)) continue;
        const key = dayKey(cursor);
        applicable += 1;
        const auto = visibleSessions.some((session) => session.kind === "focus" && session.completed && family.has(session.task_id) && dayKey(new Date(session.started_at)) === key);
        if (checkins.has(`${habit.id}|${key}`) || auto || autoCheckins.has(`${habit.id}|${key}`)) checked += 1;
      }
      return { id: habit.id, title: habit.title, checked, applicable, rate: applicable ? checked / applicable : 0 };
    }).sort((a, b) => b.rate - a.rate || b.checked - a.checked);
  }, [autoCheckins, checkins, end, startMs, systemSettings.checkinCategoryId, tasks, today, visibleSessions, visibleTasks]);

  const axisLabels = useMemo(() => days.map((point) => point.label), [days]);
  const taskAxis = useChartAxisLabels(days.length, axisLabels);
  const focusAxis = useChartAxisLabels(days.length, axisLabels);
  const maxTask = Math.max(1, ...days.flatMap((point) => [point.created, point.completed]));
  const maxFocus = Math.max(1, ...days.map((point) => point.focusMinutes));
  const focusLinePoints = days.map((point, index) => {
    const x = days.length === 1 ? 50 : (index / (days.length - 1)) * 100;
    const y = 92 - (point.focusMinutes / maxFocus) * 78;
    return { ...point, x, y };
  });

  function showBarTooltip(next: BarTooltip) {
    setBarTooltip(next);
  }

  function hideBarTooltip() {
    setBarTooltip(null);
  }

  return (
    <div className="view statistics-view">
      <header className="view-header statistics-header">
        <div>
          <h1>{t("statistics.title")}</h1>
          <p>{t("statistics.hint")}</p>
        </div>
        <div className="statistics-controls">
          <label><span>{t("statistics.range")}</span><select value={range} onChange={(event) => setRange(event.target.value as RangeKey)}>
            <option value="7d">{t("statistics.sevenDays")}</option>
            <option value="30d">{t("statistics.thirtyDays")}</option>
            <option value="90d">{t("statistics.ninetyDays")}</option>
            <option value="all">{t("statistics.allTime")}</option>
          </select></label>
          <label><span>{t("statistics.category")}</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="all">{t("statistics.allCategories")}</option>
            <option value="none">{t("statistics.uncategorized")}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select></label>
        </div>
      </header>
      {error && <p className="error-banner">{error}</p>}
      <section className="statistics-summary" aria-label={t("statistics.title")}>
        <div><span>{t("statistics.completedTasks")}</span><strong>{summary.completed}</strong></div>
        <div><span>{t("statistics.openTasks")}</span><strong>{summary.open}</strong></div>
        <div><span>{t("statistics.completionRate")}</span><strong>{Math.round(summary.completionRate * 100)}%</strong></div>
        <div><span>{t("statistics.focusTime")}</span><strong>{shortMinutes(summary.focusMinutes, t)}</strong></div>
        <div><span>{t("statistics.checkinRate")}</span><strong>{summary.applicable ? `${Math.round(summary.checkinRate * 100)}%` : "—"}</strong></div>
      </section>
      <div className="statistics-grid">
        <section className="statistics-panel statistics-panel-wide"><h2>{t("statistics.createdVsCompleted")}</h2><div ref={taskAxis.ref} className="statistics-chart statistics-bars" role="img" aria-label={t("statistics.createdVsCompleted")}>
          {days.map((point, index) => <div className="statistics-day" key={point.key}><div className="statistics-bar-pair">
            <span className="statistics-bar-hit" role="img" tabIndex={0} aria-label={`${point.label} ${t("statistics.created")}: ${point.created}`} onPointerEnter={() => showBarTooltip({ chart: "tasks", key: `${point.key}-created`, label: point.label, title: t("statistics.created"), value: String(point.created), secondary: `${t("statistics.completed")}: ${point.completed}` })} onPointerLeave={hideBarTooltip} onFocus={() => setBarTooltip({ chart: "tasks", key: `${point.key}-created`, label: point.label, title: t("statistics.created"), value: String(point.created), secondary: `${t("statistics.completed")}: ${point.completed}` })} onBlur={hideBarTooltip}><i className="bar-created" style={{ height: `${(point.created / maxTask) * 100}%` }} /></span>
            <span className="statistics-bar-hit" role="img" tabIndex={0} aria-label={`${point.label} ${t("statistics.completed")}: ${point.completed}`} onPointerEnter={() => showBarTooltip({ chart: "tasks", key: `${point.key}-completed`, label: point.label, title: t("statistics.completed"), value: String(point.completed), secondary: `${t("statistics.created")}: ${point.created}` })} onPointerLeave={hideBarTooltip} onFocus={() => setBarTooltip({ chart: "tasks", key: `${point.key}-completed`, label: point.label, title: t("statistics.completed"), value: String(point.completed), secondary: `${t("statistics.created")}: ${point.created}` })} onBlur={hideBarTooltip}><i className="bar-completed" style={{ height: `${(point.completed / maxTask) * 100}%` }} /></span>
          </div><small style={{ visibility: taskAxis.visible.has(index) ? "visible" : "hidden" }}>{point.label}</small></div>)}
          {barTooltip?.chart === "tasks" && <div className="statistics-chart-tooltip" role="status"><strong>{barTooltip.label}</strong><span>{barTooltip.title}: {barTooltip.value}</span><span>{barTooltip.secondary}</span></div>}
        </div><div className="statistics-legend"><span><i className="legend-created" />{t("statistics.created")}</span><span><i className="legend-completed" />{t("statistics.completed")}</span></div></section>
        <section className="statistics-panel statistics-panel-wide"><h2>{t("statistics.focusTrend")}</h2><div ref={focusAxis.ref} className="statistics-chart statistics-line-chart" role="img" aria-label={t("statistics.focusTrend")}>
          <svg className="statistics-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line className="statistics-line-axis" x1="0" y1="92" x2="100" y2="92" />
            <polyline className="statistics-line-path" points={focusLinePoints.map((point) => `${point.x},${point.y}`).join(" ")} />
          </svg>
          <div className="statistics-line-points" aria-hidden="true">
            {focusLinePoints.map((point) => <span className="statistics-line-point" key={point.key} style={{ left: `${point.x}%`, top: `${point.y}%` }} />)}
          </div>
          <div className="statistics-line-hit-layer">
            {days.map((point) => <span className="statistics-line-hit" key={point.key} role="img" tabIndex={0} aria-label={`${point.label} ${t("statistics.focusMinutes")}: ${Math.round(point.focusMinutes)}`} onPointerEnter={() => showBarTooltip({ chart: "focus", key: point.key, label: point.label, title: t("statistics.focusMinutes"), value: `${Math.round(point.focusMinutes)} ${t("statistics.minutes")}`, secondary: `${t("statistics.focusPomodoros")}: ${point.focusPomodoros}` })} onPointerLeave={hideBarTooltip} onFocus={() => setBarTooltip({ chart: "focus", key: point.key, label: point.label, title: t("statistics.focusMinutes"), value: `${Math.round(point.focusMinutes)} ${t("statistics.minutes")}`, secondary: `${t("statistics.focusPomodoros")}: ${point.focusPomodoros}` })} onBlur={hideBarTooltip} />)}
          </div>
          <div className="statistics-line-labels" aria-hidden="true">{days.map((point, index) => <small key={point.key} style={{ visibility: focusAxis.visible.has(index) ? "visible" : "hidden" }}>{point.label}</small>)}</div>
          {barTooltip?.chart === "focus" && <div className="statistics-chart-tooltip" role="status"><strong>{barTooltip.label}</strong><span>{barTooltip.title}: {barTooltip.value}</span><span>{barTooltip.secondary}</span></div>}
        </div><p className="statistics-chart-note">{t("statistics.focusSummary", { minutes: Math.round(summary.focusMinutes), pomodoros: summary.focusPomodoros })}</p></section>
        <section className="statistics-panel"><h2>{t("statistics.categoryBreakdown")}</h2>{categoryStats.length === 0 ? <ChartEmpty label={t("statistics.noData")} /> : <div className="statistics-category-list">{categoryStats.map((row) => { const total = row.done + row.open; return <div className="statistics-category-row" key={row.name}><div className="statistics-row-label"><span>{row.name}</span><small>{total}</small></div><div className="statistics-stack"><i className="stack-done" style={{ width: `${(row.done / total) * 100}%` }} /><i className="stack-open" style={{ width: `${(row.open / total) * 100}%` }} /></div><small>{row.done}/{total}</small></div>; })}</div>}<div className="statistics-legend"><span><i className="legend-completed" />{t("statistics.completed")}</span><span><i className="legend-open" />{t("statistics.open")}</span></div></section>
        <section className="statistics-panel"><h2>{t("statistics.checkinBreakdown")}</h2>{habitStats.length === 0 ? <ChartEmpty label={t("statistics.noData")} /> : <div className="statistics-habit-list">{habitStats.map((habit) => <div className="statistics-habit-row" key={habit.id}><div className="statistics-row-label"><span>{habit.title}</span><small>{habit.checked}/{habit.applicable}</small></div><div className="statistics-progress"><i style={{ width: `${habit.rate * 100}%` }} /></div><strong>{Math.round(habit.rate * 100)}%</strong></div>)}</div>}</section>
      </div>
    </div>
  );
}
