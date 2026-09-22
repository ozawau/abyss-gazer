export type PomodoroPhase = "focus" | "break" | "long_break";
export type PomodoroStatus = "idle" | "running" | "paused";

export interface PomodoroTick {
  status: PomodoroStatus;
  remaining: number;
  phase: PomodoroPhase;
}

export function formatPomodoroClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const s = (safe % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function pomodoroPhaseLabel(phase: PomodoroPhase): string {
  if (phase === "focus") return "专注";
  if (phase === "long_break") return "长休息";
  return "短休息";
}

export function pomodoroTimeMark(phase: PomodoroPhase, paused: boolean): string {
  if (paused) return "⏸";
  return phase === "focus" ? "🍅" : "☕️";
}

export function isPomodoroTiming(tick: PomodoroTick | null): boolean {
  return tick != null && tick.status !== "idle";
}
