import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PomodoroSettings } from "./api";
import { translate, type AppLocale } from "./i18n";
import {
  formatPomodoroClock,
  pomodoroPhaseLabel,
  pomodoroTimeMark,
  type PomodoroTick,
} from "./pomodoroTimer";

const DEFAULT_WINDOW_TITLE = "Abyss Gazer";
const IDLE_TICK: PomodoroTick = {
  status: "idle",
  remaining: 25 * 60,
  phase: "focus",
};

function resolveTick(tick: PomodoroTick | null): PomodoroTick {
  return tick ?? IDLE_TICK;
}

function presenceTitle(tick: PomodoroTick): string {
  const mark = pomodoroTimeMark(tick.phase, tick.status === "paused");
  return `${mark} ${formatPomodoroClock(tick.remaining)}`;
}

function presenceTooltip(tick: PomodoroTick, locale: AppLocale): string {
  const clock = formatPomodoroClock(tick.remaining);
  if (tick.status === "idle") return translate(locale, "presence.idle", { clock });
  const phase = pomodoroPhaseLabel(tick.phase, locale);
  if (tick.status === "paused") {
    return translate(locale, "presence.paused", { phase, clock });
  }
  return translate(locale, "presence.remaining", { phase, clock });
}

async function applyWindowFallback(windowTitle: string, badge: string) {
  try {
    const win = getCurrentWindow();
    await win.setTitle(windowTitle);
    await win.setBadgeLabel(badge);
  } catch {
    /* optional outside Tauri */
  }
}

export async function syncPomodoroPresence(
  tick: PomodoroTick | null,
  locale: AppLocale = "zh",
  settings?: PomodoroSettings | null,
): Promise<void> {
  const resolved = resolveTick(tick);
  const title = presenceTitle(resolved);
  const tooltip = presenceTooltip(resolved, locale);
  const windowTitle = `${title} · ${DEFAULT_WINDOW_TITLE}`;
  const badge = formatPomodoroClock(resolved.remaining);

  try {
    const timerActive =
      resolved.status === "running" || resolved.status === "paused";
    const timerEndsAtMs =
      resolved.status === "running"
        ? Date.now() + resolved.remaining * 1000
        : 0;
    const timerRunning = resolved.status === "running";
    const autoBreakAfterFocus =
      timerRunning &&
      !!settings?.breaksEnabled &&
      !!settings?.autoStartBreak;
    const breakSecondsAfterFocus =
      autoBreakAfterFocus && settings
        ? Math.max(1, settings.shortBreakMinutes) * 60
        : 0;
    const autoFocusAfterBreak = timerRunning && !!settings?.autoStartFocus;
    const focusSecondsAfterBreak =
      autoFocusAfterBreak && settings
        ? Math.max(1, settings.focusMinutes) * 60
        : 0;
    await invoke("set_pomodoro_tray", {
      title,
      tooltip,
      windowTitle,
      badge,
      timerActive,
      timerPaused: resolved.status === "paused",
      timerClock: formatPomodoroClock(resolved.remaining),
      timerFocusPhase: resolved.phase === "focus",
      timerEndsAtMs,
      timer_ends_at_ms: timerEndsAtMs,
      timerPhase: resolved.phase,
      timer_phase: resolved.phase,
      autoBreakAfterFocus,
      auto_break_after_focus: autoBreakAfterFocus,
      breakSecondsAfterFocus,
      break_seconds_after_focus: breakSecondsAfterFocus,
      autoFocusAfterBreak,
      auto_focus_after_break: autoFocusAfterBreak,
      focusSecondsAfterBreak,
      focus_seconds_after_break: focusSecondsAfterBreak,
    });
  } catch (err) {
    console.error("pomodoro tray update failed", err);
    await applyWindowFallback(windowTitle, badge);
  }
}
