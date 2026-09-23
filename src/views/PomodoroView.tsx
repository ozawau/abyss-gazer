import { useEffect, useMemo, useRef, useState } from "react";
import {
  countFocusSessionsSince,
  countFocusSessionsTotalSince,
  DEFAULT_POMODORO_SETTINGS,
  PomodoroSettings,
  recordPomodoroSession,
  SessionKind,
  startOfLocalDayMs,
  Task,
  updateTask,
} from "../lib/api";
import { playPomodoroEndChime } from "../lib/pomodoroChime";
import { formatTaskLineage, taskById } from "../lib/taskTree";
import {
  formatPomodoroAmount,
  formatPomodoroClock,
  pomodoroPhaseLabel,
  type PomodoroPhase,
  type PomodoroStatus,
  type PomodoroTick,
} from "../lib/pomodoroTimer";

interface PomodoroViewProps {
  tasks: Task[];
  selectedTask: Task | null;
  settings: PomodoroSettings;
  /** Increment to engage: switch task already applied; continue focus or start new. */
  playToken?: number;
  onSessionsChanged?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Whether a session is running or paused (not idle). */
  onTimingChange?: (timing: boolean) => void;
  onTick?: (tick: PomodoroTick) => void;
  onTaskChange?: (task: Task) => void;
}

type TimerPhase = PomodoroPhase;
type TimerStatus = PomodoroStatus;

function plannedFor(phase: TimerPhase, settings: PomodoroSettings): number {
  if (phase === "focus") return Math.max(1, settings.focusMinutes) * 60;
  if (phase === "long_break") {
    return Math.max(1, settings.longBreakMinutes) * 60;
  }
  return Math.max(1, settings.shortBreakMinutes) * 60;
}

function toSessionKind(phase: TimerPhase): SessionKind {
  return phase === "focus" ? "focus" : "break";
}

function isBreakPhase(phase: TimerPhase): boolean {
  return phase === "break" || phase === "long_break";
}

export function PomodoroView({
  tasks,
  selectedTask,
  settings,
  playToken = 0,
  onSessionsChanged,
  fullscreen = false,
  onToggleFullscreen,
  onTimingChange,
  onTick,
  onTaskChange,
}: PomodoroViewProps) {
  const [phase, setPhase] = useState<TimerPhase>("focus");
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [remaining, setRemaining] = useState(
    () => plannedFor("focus", DEFAULT_POMODORO_SETTINGS),
  );
  const [todayCount, setTodayCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [togglingDone, setTogglingDone] = useState(false);

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
  const boundTaskKeyRef = useRef<string | null>(
    selectedTask ? `${selectedTask.id}:${selectedTask.status}` : null,
  );
  /** Tenths of the current focus pomodoro already written to a task. */
  const creditedTenthsRef = useRef(0);
  const sliceStartedAtRef = useRef<number | null>(null);
  const taskByIdMap = useMemo(() => taskById(tasks), [tasks]);
  const selectedTaskTitle = selectedTask
    ? formatTaskLineage(selectedTask, taskByIdMap)
    : null;
  const lastTaskTitleRef = useRef<string | null>(selectedTaskTitle);

  phaseRef.current = phase;
  statusRef.current = status;
  remainingRef.current = remaining;
  selectedTaskRef.current = selectedTask;
  settingsRef.current = settings;
  if (selectedTaskTitle) lastTaskTitleRef.current = selectedTaskTitle;

  useEffect(() => {
    onTimingChange?.(status === "running" || status === "paused");
    onTick?.({ status, remaining, phase });
  }, [status, remaining, phase, onTimingChange, onTick]);

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
    const startedAt = sliceStartedAtRef.current ?? startedAtRef.current;
    if (!id || startedAt == null) return;
    const kind = toSessionKind(phaseRef.current);
    let credit = 0;
    if (completed && kind === "focus") {
      credit = Math.max(0, 10 - creditedTenthsRef.current) / 10;
      if (credit <= 0) return;
    }
    const endedAt = Math.max(Date.now(), startedAt + 1);
    try {
      await recordPomodoroSession({
        task_id: id,
        kind,
        planned_seconds: plannedRef.current,
        started_at: startedAt,
        ended_at: endedAt,
        completed,
        credit,
      });
      onSessionsChanged?.();
      if (completed && kind === "focus") {
        const n = await countFocusSessionsSince(id, startOfLocalDayMs());
        if (selectedTaskRef.current?.id === id) setTodayCount(n);
      }
    } catch (err) {
      const message = String(err);
      if (message.includes("Task not found")) return;
      setError(message);
    }
  }

  async function creditElapsedFocus(taskId: string) {
    if (finishingRef.current || phaseRef.current !== "focus") return;
    if (startedAtRef.current == null) return;
    const planned = plannedRef.current;
    if (planned <= 0) return;
    const progress = Math.min(
      1,
      Math.max(0, (planned - remainingRef.current) / planned),
    );
    const sliceTenths = Math.round(progress * 10) - creditedTenthsRef.current;
    if (sliceTenths <= 0) return;
    creditedTenthsRef.current += sliceTenths;
    const startedAt = sliceStartedAtRef.current ?? startedAtRef.current;
    const endedAt = Math.max(Date.now(), startedAt + 1);
    sliceStartedAtRef.current = endedAt;
    try {
      await recordPomodoroSession({
        task_id: taskId,
        kind: "focus",
        planned_seconds: planned,
        started_at: startedAt,
        ended_at: endedAt,
        completed: true,
        credit: sliceTenths / 10,
      });
      onSessionsChanged?.();
      const n = await countFocusSessionsSince(taskId, startOfLocalDayMs());
      if (selectedTaskRef.current?.id === taskId) setTodayCount(n);
    } catch (err) {
      creditedTenthsRef.current -= sliceTenths;
      const message = String(err);
      if (!message.includes("Task not found")) setError(message);
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
      const tenths = Math.round(todayTotal * 10);
      if (
        cfg.longBreakEnabled &&
        cfg.longBreakInterval > 0 &&
        tenths > 0 &&
        tenths % (cfg.longBreakInterval * 10) === 0
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
      creditedTenthsRef.current = 0;
      const now = Date.now();
      startedAtRef.current = now;
      sliceStartedAtRef.current = now;
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
    if (completed) {
      const endedBreak = isBreakPhase(current);
      void playPomodoroEndChime(
        endedBreak ? "break" : "focus",
        endedBreak
          ? settingsRef.current.breakEndSound
          : settingsRef.current.focusEndSound,
      );
    }
    await persistSession(completed);
    startedAtRef.current = null;
    sliceStartedAtRef.current = null;
    sessionTaskIdRef.current = null;
    creditedTenthsRef.current = 0;

    const nextPhase = await nextPhaseFrom(current, completed);
    const nextPlanned = plannedFor(nextPhase, settingsRef.current);
    setPhase(nextPhase);
    plannedRef.current = nextPlanned;
    setRemaining(nextPlanned);
    finishingRef.current = false;
    maybeAutoStart(nextPhase);
  }

  useEffect(() => {
    const next = selectedTask
      ? `${selectedTask.id}:${selectedTask.status}`
      : null;
    const prev = boundTaskKeyRef.current;
    boundTaskKeyRef.current = next;

    if (prev === next) return;
    const active =
      statusRef.current === "running" || statusRef.current === "paused";
    if (!active || startedAtRef.current == null) return;

    const deleted = prev != null && next == null;
    const completed =
      selectedTask != null &&
      selectedTask.status === "done" &&
      prev != null &&
      prev.endsWith(":todo") &&
      prev.startsWith(`${selectedTask.id}:`);
    if (
      completed &&
      phaseRef.current === "focus" &&
      (sessionTaskIdRef.current == null ||
        sessionTaskIdRef.current === selectedTask.id)
    ) {
      void creditElapsedFocus(selectedTask.id);
    }
    if ((deleted || completed) && statusRef.current === "running") {
      setStatus("paused");
    }
  }, [selectedTask]);

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
      creditedTenthsRef.current = 0;
      const now = Date.now();
      startedAtRef.current = now;
      sliceStartedAtRef.current = now;
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
    sliceStartedAtRef.current = null;
    sessionTaskIdRef.current = null;
    creditedTenthsRef.current = 0;
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
          const now = Date.now();
          startedAtRef.current = now;
          sliceStartedAtRef.current = now;
          sessionTaskIdRef.current = task.id;
        });
      } else {
        sessionTaskIdRef.current = task.id;
      }
      setError(null);
      return;
    }

    const resumable =
      statusRef.current === "paused" &&
      remainingRef.current > 0 &&
      startedAtRef.current != null;
    if (resumable) {
      sessionTaskIdRef.current = task.id;
      setError(null);
      setStatus("running");
      return;
    }

    void (async () => {
      setError(null);
      finishingRef.current = false;
      if (startedAtRef.current != null) {
        await persistSession(false);
      }
      creditedTenthsRef.current = 0;
      const now = Date.now();
      startedAtRef.current = now;
      sliceStartedAtRef.current = now;
      sessionTaskIdRef.current = task.id;
      setPhase("focus");
      const next = plannedFor("focus", settingsRef.current);
      plannedRef.current = next;
      setRemaining(next);
      setStatus("running");
    })();
  }, [playToken]);

  async function toggleBoundTask() {
    const task = selectedTaskRef.current;
    if (!task || togglingDone) return;
    setTogglingDone(true);
    setError(null);
    try {
      const next = await updateTask({
        id: task.id,
        status: task.status === "done" ? "todo" : "done",
      });
      onTaskChange?.(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setTogglingDone(false);
    }
  }

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

      {!selectedTask && status === "idle" ? (
        <div className="pomodoro-locked">
          <p>请先在「任务」中选择一个任务。</p>
        </div>
      ) : (
        <div className="pomodoro-panel">
          <div className="pomodoro-task">
            <span className="chip-label">专注于</span>
            <div className="pomodoro-task-line">
              {selectedTask && (
                <button
                  type="button"
                  className={`task-check${selectedTask.status === "done" ? " is-done" : ""}`}
                  aria-label={
                    selectedTask.status === "done" ? "标记为未完成" : "标记为完成"
                  }
                  disabled={togglingDone}
                  onClick={() => void toggleBoundTask()}
                />
              )}
              <strong>
                {selectedTaskTitle ?? lastTaskTitleRef.current ?? "任务已删除"}
              </strong>
            </div>
            {selectedTask ? (
              <span className="focus-count">
                今日专注 {formatPomodoroAmount(todayCount)} 个
              </span>
            ) : (
              <span className="focus-count">任务已删除，计时已暂停</span>
            )}
          </div>

          <div
            className={`timer-ring phase-${ringPhase}${status === "paused" ? " is-paused" : ""}`}
            style={{ ["--progress" as string]: String(progress) }}
          >
            <div className="timer-face">
              <span className="timer-phase">{pomodoroPhaseLabel(phase)}</span>
              <span className="timer-digits">{formatPomodoroClock(remaining)}</span>
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
              <button
                type="button"
                className={`primary-btn${status === "paused" ? " is-resume" : ""}`}
                onClick={start}
                disabled={!selectedTask}
              >
                {status === "paused" ? "继续" : "开始"}
              </button>
            ) : (
              <button type="button" className="primary-btn is-pause" onClick={pause}>
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
