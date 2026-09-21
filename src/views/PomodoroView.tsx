import { useEffect, useRef, useState } from "react";
import {
  countFocusSessionsSince,
  countFocusSessionsTotalSince,
  DEFAULT_POMODORO_SETTINGS,
  PomodoroSettings,
  recordPomodoroSession,
  SessionKind,
  startOfLocalDayMs,
  Task,
} from "../lib/api";

interface PomodoroViewProps {
  selectedTask: Task | null;
  settings: PomodoroSettings;
  /** Increment to engage: switch task already applied; continue focus or start new. */
  playToken?: number;
  onSessionsChanged?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Whether a session is running or paused (not idle). */
  onTimingChange?: (timing: boolean) => void;
}

type TimerPhase = "focus" | "break" | "long_break";
type TimerStatus = "idle" | "running" | "paused";

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function plannedFor(phase: TimerPhase, settings: PomodoroSettings): number {
  if (phase === "focus") return Math.max(1, settings.focusMinutes) * 60;
  if (phase === "long_break") {
    return Math.max(1, settings.longBreakMinutes) * 60;
  }
  return Math.max(1, settings.shortBreakMinutes) * 60;
}

function phaseLabel(phase: TimerPhase): string {
  if (phase === "focus") return "专注";
  if (phase === "long_break") return "长休息";
  return "短休息";
}

function toSessionKind(phase: TimerPhase): SessionKind {
  return phase === "focus" ? "focus" : "break";
}

function isBreakPhase(phase: TimerPhase): boolean {
  return phase === "break" || phase === "long_break";
}

export function PomodoroView({
  selectedTask,
  settings,
  playToken = 0,
  onSessionsChanged,
  fullscreen = false,
  onToggleFullscreen,
  onTimingChange,
}: PomodoroViewProps) {
  const [phase, setPhase] = useState<TimerPhase>("focus");
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [remaining, setRemaining] = useState(
    () => plannedFor("focus", DEFAULT_POMODORO_SETTINGS),
  );
  const [todayCount, setTodayCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef(phase);
  const statusRef = useRef(status);
  const remainingRef = useRef(remaining);
  const startedAtRef = useRef<number | null>(null);
  const plannedRef = useRef(plannedFor("focus", DEFAULT_POMODORO_SETTINGS));
  const finishingRef = useRef(false);
  const selectedTaskRef = useRef(selectedTask);
  const sessionTaskIdRef = useRef<string | null>(null);
  const lastPlayTokenRef = useRef(0);
  const settingsRef = useRef(settings);

  phaseRef.current = phase;
  statusRef.current = status;
  remainingRef.current = remaining;
  selectedTaskRef.current = selectedTask;
  settingsRef.current = settings;

  useEffect(() => {
    onTimingChange?.(status === "running" || status === "paused");
  }, [status, onTimingChange]);

  // Apply duration changes while idle so the next session uses new settings.
  useEffect(() => {
    if (statusRef.current !== "idle" || startedAtRef.current != null) return;
    if (!settings.breaksEnabled && isBreakPhase(phaseRef.current)) {
      setPhase("focus");
      const next = plannedFor("focus", settings);
      plannedRef.current = next;
      setRemaining(next);
      return;
    }
    const next = plannedFor(phaseRef.current, settings);
    plannedRef.current = next;
    setRemaining(next);
  }, [settings]);

  useEffect(() => {
    if (!selectedTask) {
      setTodayCount(0);
      return;
    }
    let cancelled = false;
    countFocusSessionsSince(selectedTask.id, startOfLocalDayMs())
      .then((n) => {
        if (!cancelled) setTodayCount(n);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTask?.id]);

  async function persistSession(completed: boolean, taskId?: string | null) {
    const id = taskId ?? sessionTaskIdRef.current ?? selectedTaskRef.current?.id;
    if (!id || startedAtRef.current == null) return;
    const endedAt = Date.now();
    const kind = toSessionKind(phaseRef.current);
    try {
      await recordPomodoroSession({
        task_id: id,
        kind,
        planned_seconds: plannedRef.current,
        started_at: startedAtRef.current,
        ended_at: endedAt,
        completed,
      });
      onSessionsChanged?.();
      if (completed && kind === "focus") {
        const n = await countFocusSessionsSince(id, startOfLocalDayMs());
        if (selectedTaskRef.current?.id === id) setTodayCount(n);
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function resolveNextPhaseAfterFocus(
    completedFocus: boolean,
  ): Promise<TimerPhase> {
    const cfg = settingsRef.current;
    if (!cfg.breaksEnabled) return "focus";
    if (!completedFocus) return "break";

    try {
      const todayTotal = await countFocusSessionsTotalSince(startOfLocalDayMs());
      if (
        cfg.longBreakEnabled &&
        cfg.longBreakInterval > 0 &&
        todayTotal > 0 &&
        todayTotal % cfg.longBreakInterval === 0
      ) {
        return "long_break";
      }
    } catch (err) {
      setError(String(err));
    }
    return "break";
  }

  async function nextPhaseFrom(
    current: TimerPhase,
    completed: boolean,
  ): Promise<TimerPhase> {
    if (current === "focus") {
      return resolveNextPhaseAfterFocus(completed);
    }
    return "focus";
  }

  function maybeAutoStart(nextPhase: TimerPhase) {
    const cfg = settingsRef.current;
    const shouldAuto =
      (nextPhase === "focus" && cfg.autoStartFocus) ||
      (isBreakPhase(nextPhase) && cfg.autoStartBreak && cfg.breaksEnabled);
    if (!shouldAuto || !selectedTaskRef.current) return;
    window.setTimeout(() => {
      if (statusRef.current !== "idle" || finishingRef.current) return;
      if (!selectedTaskRef.current) return;
      startedAtRef.current = Date.now();
      sessionTaskIdRef.current = selectedTaskRef.current.id;
      plannedRef.current = plannedFor(nextPhase, settingsRef.current);
      setRemaining(plannedRef.current);
      setStatus("running");
    }, 0);
  }

  async function finishSegment(completed: boolean) {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setStatus("idle");
    const current = phaseRef.current;
    await persistSession(completed);
    startedAtRef.current = null;
    sessionTaskIdRef.current = null;

    const nextPhase = await nextPhaseFrom(current, completed);
    const nextPlanned = plannedFor(nextPhase, settingsRef.current);
    setPhase(nextPhase);
    plannedRef.current = nextPlanned;
    setRemaining(nextPlanned);
    finishingRef.current = false;
    maybeAutoStart(nextPhase);
  }

  useEffect(() => {
    if (status !== "running") return;

    const id = window.setInterval(() => {
      if (finishingRef.current) return;
      const next = remainingRef.current - 1;
      if (next <= 0) {
        setRemaining(0);
        void finishSegment(true);
        return;
      }
      setRemaining(next);
    }, 1000);

    return () => window.clearInterval(id);
  }, [status]);

  function start() {
    if (!selectedTaskRef.current) return;
    setError(null);
    if (statusRef.current === "idle") {
      if (
        isBreakPhase(phaseRef.current) &&
        !settingsRef.current.breaksEnabled
      ) {
        setPhase("focus");
        phaseRef.current = "focus";
        const next = plannedFor("focus", settingsRef.current);
        plannedRef.current = next;
        setRemaining(next);
      }
      startedAtRef.current = Date.now();
      sessionTaskIdRef.current = selectedTaskRef.current.id;
      plannedRef.current = plannedFor(phaseRef.current, settingsRef.current);
      if (remainingRef.current <= 0) {
        setRemaining(plannedRef.current);
      }
    }
    setStatus("running");
  }

  function pause() {
    setStatus("paused");
  }

  async function skip() {
    if (!selectedTaskRef.current) return;
    if (statusRef.current === "idle" && startedAtRef.current == null) {
      const nextPhase = await nextPhaseFrom(phaseRef.current, false);
      const nextPlanned = plannedFor(nextPhase, settingsRef.current);
      setPhase(nextPhase);
      plannedRef.current = nextPlanned;
      setRemaining(nextPlanned);
      return;
    }
    await finishSegment(false);
  }

  async function reset() {
    if (startedAtRef.current != null) {
      await persistSession(false);
    }
    startedAtRef.current = null;
    sessionTaskIdRef.current = null;
    finishingRef.current = false;
    setStatus("idle");
    setPhase("focus");
    const next = plannedFor("focus", settingsRef.current);
    plannedRef.current = next;
    setRemaining(next);
  }

  useEffect(() => {
    if (!playToken || playToken === lastPlayTokenRef.current) return;
    lastPlayTokenRef.current = playToken;

    const task = selectedTaskRef.current;
    if (!task) return;

    const continuingFocus =
      phaseRef.current === "focus" && statusRef.current === "running";

    if (continuingFocus) {
      if (
        sessionTaskIdRef.current &&
        sessionTaskIdRef.current !== task.id &&
        startedAtRef.current != null
      ) {
        const previousId = sessionTaskIdRef.current;
        void persistSession(false, previousId).then(() => {
          startedAtRef.current = Date.now();
          sessionTaskIdRef.current = task.id;
        });
      } else {
        sessionTaskIdRef.current = task.id;
      }
      setError(null);
      return;
    }

    void (async () => {
      setError(null);
      finishingRef.current = false;
      if (startedAtRef.current != null) {
        await persistSession(false);
      }
      startedAtRef.current = Date.now();
      sessionTaskIdRef.current = task.id;
      setPhase("focus");
      const next = plannedFor("focus", settingsRef.current);
      plannedRef.current = next;
      setRemaining(next);
      setStatus("running");
    })();
  }, [playToken]);

  const progress =
    plannedRef.current > 0 ? 1 - remaining / plannedRef.current : 0;
  const ringPhase = phase === "focus" ? "focus" : "break";

  return (
    <div className={`view pomodoro-view${fullscreen ? " is-fullscreen" : ""}`}>
      <header className="view-header pomodoro-header">
        <div className="pomodoro-header-text">
          <h1>番茄钟</h1>
          <p>选中任务后再开始专注。</p>
        </div>
        {onToggleFullscreen && (
          <button
            type="button"
            className="secondary-btn pomodoro-fullscreen-btn"
            onClick={onToggleFullscreen}
            title={fullscreen ? "退出全屏" : "应用内全屏"}
          >
            {fullscreen ? "退出全屏" : "全屏"}
          </button>
        )}
      </header>

      {!selectedTask ? (
        <div className="pomodoro-locked">
          <p>请先在「任务」中选择一个任务。</p>
        </div>
      ) : (
        <div className="pomodoro-panel">
          <div className="pomodoro-task">
            <span className="chip-label">专注于</span>
            <strong>{selectedTask.title}</strong>
            <span className="focus-count">今日专注 {todayCount} 次</span>
          </div>

          <div
            className={`timer-ring phase-${ringPhase}`}
            style={{ ["--progress" as string]: String(progress) }}
          >
            <div className="timer-face">
              <span className="timer-phase">{phaseLabel(phase)}</span>
              <span className="timer-digits">{formatTime(remaining)}</span>
              <span className="timer-status">
                {status === "running"
                  ? "进行中"
                  : status === "paused"
                    ? "已暂停"
                    : "待开始"}
              </span>
            </div>
          </div>

          <div className="timer-controls">
            {status !== "running" ? (
              <button type="button" className="primary-btn" onClick={start}>
                {status === "paused" ? "继续" : "开始"}
              </button>
            ) : (
              <button type="button" className="primary-btn" onClick={pause}>
                暂停
              </button>
            )}
            <button type="button" className="secondary-btn" onClick={skip}>
              跳过
            </button>
            <button type="button" className="secondary-btn" onClick={reset}>
              重置
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-banner">{error}</p>}
    </div>
  );
}
