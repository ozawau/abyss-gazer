import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSystemSettings, listPomodoroSessionsInRange, listTasks } from "../lib/api";
import {
  addMonths,
  buildMonthGrid,
  calendarRangeMs,
  countDayActivity,
  dayKey,
  DEFAULT_WEEK_STARTS_ON,
  normalizeWeekStartsOn,
  sameDay,
  startOfLocalDay,
  weekdayShortLabels,
  type WeekStartsOn,
} from "../lib/calendar";
import { leafTasks } from "../lib/taskTree";
import { useI18n } from "../components/LocaleProvider";
import "../styles/tray-calendar.css";

const COLS = 7;
const ROWS = 6;

function isTrayHost(): boolean {
  try {
    return getCurrentWindow().label === "tray-calendar";
  } catch {
    return false;
  }
}

export function TrayCalendar() {
  const { locale, t } = useI18n();
  document.documentElement.classList.add("tray-calendar-root");
  const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStartsOn>(DEFAULT_WEEK_STARTS_ON);
  const [markedDays, setMarkedDays] = useState<ReadonlySet<string>>(() => new Set());
  const [reloadToken, setReloadToken] = useState(0);
  const today = useMemo(() => startOfLocalDay(new Date()), [reloadToken]);

  useEffect(() => {
    return () => {
      document.documentElement.classList.remove("tray-calendar-root");
    };
  }, []);

  useEffect(() => {
    if (!isTrayHost()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("tray-calendar-shown", () => {
          if (cancelled) return;
          setCursor(startOfLocalDay(new Date()));
          setReloadToken((token) => token + 1);
        }),
      )
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTrayHost()) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      void getCurrentWindow().hide().catch(() => {});
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSystemSettings()
      .then((settings) => {
        if (!cancelled) setWeekStartsOn(normalizeWeekStartsOn(settings.weekStartsOn));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const loadMarks = useCallback((anchor: Date, week: WeekStartsOn) => {
    let cancelled = false;
    const { startMs, endMs } = calendarRangeMs("month", anchor, week);
    Promise.all([listTasks(), listPomodoroSessionsInRange(startMs, endMs)])
      .then(([tasks, sessions]) => {
        if (cancelled) return;
        const leaves = leafTasks(tasks);
        const leafIds = new Set(leaves.map((task) => task.id));
        const visibleSessions = sessions.filter((session) => leafIds.has(session.task_id));
        const marked = new Set<string>();
        for (const day of buildMonthGrid(anchor, week)) {
          if (countDayActivity(leaves, visibleSessions, day) > 0) {
            marked.add(dayKey(day));
          }
        }
        setMarkedDays(marked);
      })
      .catch(() => {
        if (!cancelled) setMarkedDays(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => loadMarks(cursor, weekStartsOn), [cursor, weekStartsOn, loadMarks]);

  const cells = useMemo(
    () => buildMonthGrid(cursor, weekStartsOn),
    [cursor, weekStartsOn],
  );
  const month = cursor.getMonth();
  const weekdays = weekdayShortLabels(weekStartsOn, locale);
  const outline = useMemo(
    () => monthOutlinePath(cells.map((day) => day.getMonth() === month)),
    [cells, month],
  );

  function goToday() {
    setCursor(startOfLocalDay(new Date()));
  }

  return (
    <section className="tray-cal" aria-label={t("tray.calendar")}>
      <header className="tray-cal-header">
        <h1>
          {locale === "en"
            ? cursor.toLocaleDateString("en", { month: "long", year: "numeric" })
            : `${cursor.getMonth() + 1}月 ${cursor.getFullYear()}`}
        </h1>
        <div className="tray-cal-nav">
          <button type="button" aria-label={t("tray.prevMonth")} onClick={() => setCursor(addMonths(cursor, -1))}>
            <Chevron direction="left" />
          </button>
          <button type="button" className="tray-cal-today-btn" aria-label={t("common.today")} onClick={goToday} />
          <button type="button" aria-label={t("tray.nextMonth")} onClick={() => setCursor(addMonths(cursor, 1))}>
            <Chevron direction="right" />
          </button>
        </div>
      </header>
      <div className="tray-cal-weekdays">
        {weekdays.map((label, index) => (
          <span key={`${label}-${index}`}>{label}</span>
        ))}
      </div>
      <div className="tray-cal-grid">
        <svg className="tray-cal-outline" viewBox={`0 0 ${COLS} ${ROWS}`} aria-hidden>
          <path d={outline} />
        </svg>
        {cells.map((day) => {
          const inMonth = day.getMonth() === month;
          const marked = markedDays.has(dayKey(day));
          const isToday = sameDay(day, today);
          return (
            <div
              key={dayKey(day)}
              className={`tray-cal-day${inMonth ? "" : " is-outside"}`}
            >
              <div className={`tray-cal-mark${isToday ? " is-today" : ""}`}>
                <span className="tray-cal-num">{day.getDate()}</span>
                <span className={`tray-cal-dot${marked ? " is-on" : ""}`} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path
        d={direction === "left" ? "M7.5 2.2 3.7 6l3.8 3.8" : "M4.5 2.2 8.3 6 4.5 9.8"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rounded outline around the in-month cells, including the stepped corners. */
function monthOutlinePath(inMonth: boolean[]): string {
  const inside = (row: number, col: number) =>
    row >= 0 && row < ROWS && col >= 0 && col < COLS && inMonth[row * COLS + col] === true;
  const segs: Array<[number, number, number, number]> = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!inside(row, col)) continue;
      if (!inside(row - 1, col)) segs.push([col, row, col + 1, row]);
      if (!inside(row, col + 1)) segs.push([col + 1, row, col + 1, row + 1]);
      if (!inside(row + 1, col)) segs.push([col + 1, row + 1, col, row + 1]);
      if (!inside(row, col - 1)) segs.push([col, row + 1, col, row]);
    }
  }
  if (segs.length === 0) return "";
  const next = new Map<string, [number, number, number, number]>();
  for (const seg of segs) next.set(`${seg[0]},${seg[1]}`, seg);

  const points: Array<[number, number]> = [];
  let seg = segs[0]!;
  do {
    points.push([seg[0], seg[1]]);
    const following = next.get(`${seg[2]},${seg[3]}`);
    if (!following) return "";
    seg = following;
  } while (seg !== segs[0]);

  const corners = simplifyOutline(points);
  const inset = 0.08;
  const offset = corners.map((point, index) => {
    const prev = corners[(index - 1 + corners.length) % corners.length]!;
    const nextPoint = corners[(index + 1) % corners.length]!;
    const [inx, iny] = inward(point[0] - prev[0], point[1] - prev[1]);
    const [outx, outy] = inward(nextPoint[0] - point[0], nextPoint[1] - point[1]);
    return [point[0] + (inx + outx) * inset, point[1] + (iny + outy) * inset] as [
      number,
      number,
    ];
  });
  return roundedLoop(offset, 0.22);
}

function simplifyOutline(points: Array<[number, number]>): Array<[number, number]> {
  const corners: Array<[number, number]> = [];
  const count = points.length;
  for (let index = 0; index < count; index++) {
    const prev = points[(index - 1 + count) % count]!;
    const curr = points[index]!;
    const next = points[(index + 1) % count]!;
    const cross =
      (curr[0] - prev[0]) * (next[1] - curr[1]) -
      (curr[1] - prev[1]) * (next[0] - curr[0]);
    if (Math.abs(cross) > 1e-6) corners.push(curr);
  }
  return corners;
}

function inward(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

function roundedLoop(points: Array<[number, number]>, radius: number): string {
  const count = points.length;
  if (count < 3) return "";
  const cmds: string[] = [];
  for (let index = 0; index < count; index++) {
    const prev = points[(index - 1 + count) % count]!;
    const curr = points[index]!;
    const next = points[(index + 1) % count]!;
    const inX = curr[0] - prev[0];
    const inY = curr[1] - prev[1];
    const outX = next[0] - curr[0];
    const outY = next[1] - curr[1];
    const inLen = Math.hypot(inX, inY) || 1;
    const outLen = Math.hypot(outX, outY) || 1;
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const startX = curr[0] - (inX / inLen) * r;
    const startY = curr[1] - (inY / inLen) * r;
    const endX = curr[0] + (outX / outLen) * r;
    const endY = curr[1] + (outY / outLen) * r;
    const cross = (inX / inLen) * (outY / outLen) - (inY / inLen) * (outX / outLen);
    const sweep = cross > 0 ? 1 : 0;
    const fmt = (value: number) => value.toFixed(3);
    if (index === 0) cmds.push(`M ${fmt(startX)} ${fmt(startY)}`);
    else cmds.push(`L ${fmt(startX)} ${fmt(startY)}`);
    cmds.push(`A ${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${fmt(endX)} ${fmt(endY)}`);
  }
  cmds.push("Z");
  return cmds.join(" ");
}
