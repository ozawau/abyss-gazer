import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

function presenceTooltip(tick: PomodoroTick): string {
  const clock = formatPomodoroClock(tick.remaining);
  if (tick.status === "idle") return `番茄钟 ${clock}`;
  if (tick.status === "paused") {
    return `${pomodoroPhaseLabel(tick.phase)}已暂停 ${clock}`;
  }
  return `${pomodoroPhaseLabel(tick.phase)}剩余 ${clock}`;
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
): Promise<void> {
  const resolved = resolveTick(tick);
  const title = presenceTitle(resolved);
  const tooltip = presenceTooltip(resolved);
  const windowTitle = `${title} · ${DEFAULT_WINDOW_TITLE}`;
  const badge = formatPomodoroClock(resolved.remaining);

  try {
    await invoke("set_pomodoro_tray", {
      title,
      tooltip,
      windowTitle,
      badge,
    });
  } catch (err) {
    console.error("pomodoro tray update failed", err);
    await applyWindowFallback(windowTitle, badge);
  }
}
