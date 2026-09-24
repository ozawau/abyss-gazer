import { translate, type AppLocale } from "./i18n";

export type PomodoroPhase = "focus" | "break" | "long_break";
export type PomodoroStatus = "idle" | "running" | "paused";

export interface PomodoroTick {
  status: PomodoroStatus;
  remaining: number;
  phase: PomodoroPhase;
}

/** One decimal when needed: 0.3 stays "0.3", 2 stays "2". */
export function formatPomodoroAmount(value: number): string {
  const tenths = Math.round(value * 10);
  if (!Number.isFinite(tenths)) return "0";
  if (tenths % 10 === 0) return String(tenths / 10);
  return (tenths / 10).toFixed(1);
}

export function formatPomodoroClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const s = (safe % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function pomodoroPhaseLabel(phase: PomodoroPhase, locale: AppLocale = "zh"): string {
  if (phase === "focus") return translate(locale, "phase.focus");
  if (phase === "long_break") return translate(locale, "phase.longBreak");
  return translate(locale, "phase.shortBreak");
}

export function pomodoroTimeMark(phase: PomodoroPhase, paused: boolean): string {
  if (paused) return "⏸";
  return phase === "focus" ? "🍅" : "☕️";
}

export function isPomodoroTiming(tick: PomodoroTick | null): boolean {
  return tick != null && tick.status !== "idle";
}
