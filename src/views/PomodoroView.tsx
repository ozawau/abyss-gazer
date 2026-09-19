import { useEffect, useRef, useState } from "react";
import {
  countFocusSessionsSince,
  recordPomodoroSession,
  SessionKind,
  startOfLocalDayMs,
  Task,
} from "../lib/api";

const FOCUS_SECONDS = 25 * 60;
const BREAK_SECONDS = 5 * 60;

interface PomodoroViewProps {
  selectedTask: Task | null;
}

type TimerPhase = SessionKind;
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

function plannedFor(phase: TimerPhase): number {
  return phase === "focus" ? FOCUS_SECONDS : BREAK_SECONDS;
}

export function PomodoroView({ selectedTask }: PomodoroViewProps) {
  const [phase, setPhase] = useState<TimerPhase>("focus");
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [remaining, setRemaining] = useState(FOCUS_SECONDS);
  const [todayCount, setTodayCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const phaseRef = useRef(phase);
  const statusRef = useRef(status);
  const remainingRef = useRef(remaining);
  const startedAtRef = useRef<number | null>(null);
  const plannedRef = useRef(FOCUS_SECONDS);
  const finishingRef = useRef(false);
  const selectedTaskRef = useRef(selectedTask);

  phaseRef.current = phase;
  statusRef.current = status;
  remainingRef.current = remaining;
  selectedTaskRef.current = selectedTask;

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

  async function persistSession(completed: boolean) {
    const task = selectedTaskRef.current;
    if (!task || startedAtRef.current == null) return;
    const endedAt = Date.now();
    const kind = phaseRef.current;
    try {
      await recordPomodoroSession({
        task_id: task.id,
        kind,
        planned_seconds: plannedRef.current,
        started_at: startedAtRef.current,
        ended_at: endedAt,
        completed,
      });
      if (completed && kind === "focus") {
        const n = await countFocusSessionsSince(task.id, startOfLocalDayMs());
        setTodayCount(n);
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function finishSegment(completed: boolean) {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setStatus("idle");
    await persistSession(completed);
    startedAtRef.current = null;

    const nextPhase: TimerPhase =
      phaseRef.current === "focus" ? "break" : "focus";
    const nextPlanned = plannedFor(nextPhase);
    setPhase(nextPhase);
    plannedRef.current = nextPlanned;
    setRemaining(nextPlanned);
    finishingRef.current = false;
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
      startedAtRef.current = Date.now();
      plannedRef.current = plannedFor(phaseRef.current);
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
      const nextPhase: TimerPhase =
        phaseRef.current === "focus" ? "break" : "focus";
      const nextPlanned = plannedFor(nextPhase);
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
    finishingRef.current = false;
    setStatus("idle");
    setPhase("focus");
    plannedRef.current = FOCUS_SECONDS;
    setRemaining(FOCUS_SECONDS);
  }

  const progress =
    plannedRef.current > 0 ? 1 - remaining / plannedRef.current : 0;

  return (
    <div className="view pomodoro-view">
      <header className="view-header">
        <h1>番茄钟</h1>
        <p>选中任务后再开始专注。</p>
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
            className={`timer-ring phase-${phase}`}
            style={{ ["--progress" as string]: String(progress) }}
          >
            <div className="timer-face">
              <span className="timer-phase">
                {phase === "focus" ? "专注" : "休息"}
              </span>
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
