import { useEffect, useRef, useState } from "react";
import { dayKey, startOfLocalDay } from "./calendar";

export const LOCAL_TODAY_REFRESH_EVENT = "abyss-local-today-refresh";

export function notifyLocalTodayRefresh(): void {
  window.dispatchEvent(new Event(LOCAL_TODAY_REFRESH_EVENT));
}

/** Local calendar "today" — refreshes at midnight, on foreground, and on in-app tab changes. */
export function useLocalToday(): Date {
  const [today, setToday] = useState(() => startOfLocalDay(new Date()));

  useEffect(() => {
    function refresh() {
      const next = startOfLocalDay(new Date());
      setToday((prev) => (dayKey(prev) === dayKey(next) ? prev : next));
    }

    function scheduleMidnight(): number {
      const now = new Date();
      const nextMidnight = startOfLocalDay(now);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      const delay = Math.max(nextMidnight.getTime() - now.getTime(), 1000);
      return window.setTimeout(() => {
        refresh();
        midnightTimer = scheduleMidnight();
      }, delay);
    }

    let midnightTimer = scheduleMidnight();

    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("abyss-foreground", refresh);
    window.addEventListener(LOCAL_TODAY_REFRESH_EVENT, refresh);

    return () => {
      window.clearTimeout(midnightTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("abyss-foreground", refresh);
      window.removeEventListener(LOCAL_TODAY_REFRESH_EVENT, refresh);
    };
  }, []);

  return today;
}

/** If `day` still points at the previous calendar day, roll it forward to the new `today`. */
export function useFollowLocalToday(
  today: Date,
  setDay: (value: Date | ((prev: Date) => Date)) => void,
) {
  const lastTodayKeyRef = useRef(dayKey(today));

  useEffect(() => {
    const newKey = dayKey(today);
    const oldKey = lastTodayKeyRef.current;
    lastTodayKeyRef.current = newKey;
    if (newKey === oldKey) return;
    setDay((prev) => (dayKey(prev) === oldKey ? today : prev));
  }, [today, setDay]);
}
