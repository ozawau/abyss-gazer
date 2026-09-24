import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
import { useI18n } from "./LocaleProvider";

interface ClockEstimatePickerProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  /** Visual quick picks (default 4). */
  maxQuick?: number;
}

function ClockGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      className={`clock-glyph${filled ? " is-filled" : ""}`}
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M8 4.5V8l2.4 1.5"
        fill="none"
        stroke={filled ? "#fff" : "currentColor"}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClockEstimatePicker({
  value,
  onChange,
  disabled,
  maxQuick = 4,
}: ClockEstimatePickerProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState(String(value || ""));
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!customOpen) return;
    setDraft(value > 0 ? String(value) : "");
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [customOpen, value]);

  function selectQuick(n: number) {
    if (disabled) return;
    if (n === 1 && value === 1) {
      onChange(0);
      return;
    }
    onChange(n);
  }

  function applyCustom() {
    if (disabled) return;
    const parsed = Number.parseInt(draft.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    onChange(Math.min(99, parsed));
    setCustomOpen(false);
  }

  function onCustomKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setCustomOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      applyCustom();
    }
  }

  return (
    <div
      className={`clock-estimate-picker${disabled ? " is-disabled" : ""}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="clock-estimate-quick" role="group" aria-label={t("clock.group")}>
        {Array.from({ length: maxQuick }, (_, i) => {
          const n = i + 1;
          const active = value >= n;
          return (
            <button
              key={n}
              type="button"
              className={`clock-estimate-btn${active ? " is-active" : ""}`}
              aria-label={t("clock.expectN", { count: n })}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => selectQuick(n)}
            >
              <ClockGlyph filled={active} />
            </button>
          );
        })}
        <button
          type="button"
          className={`clock-estimate-more${value > maxQuick ? " is-active" : ""}`}
          title={t("clock.custom")}
          aria-label={t("clock.customLabel")}
          disabled={disabled}
          onClick={() => setCustomOpen((v) => !v)}
        >
          …
        </button>
      </div>
      {value > maxQuick && !customOpen && (
        <span className="clock-estimate-value" title={t("clock.expectValue", { count: value })}>
          ×{value}
        </span>
      )}
      {customOpen && (
        <div className="clock-estimate-custom">
          <input
            ref={inputRef}
            type="number"
            min={0}
            max={99}
            inputMode="numeric"
            value={draft}
            disabled={disabled}
            aria-label={t("clock.amount")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onCustomKeyDown}
          />
          <button
            type="button"
            className="ghost-btn"
            disabled={disabled}
            onClick={applyCustom}
          >
            {t("common.confirm")}
          </button>
        </div>
      )}
    </div>
  );
}

interface TaskPomodoroClocksProps {
  estimate: number;
  completed: number;
}

const MAX_TASK_CLOCK_ICONS = 5;

/** Read-only progress: filled = completed, outline = remaining estimate. */
export function TaskPomodoroClocks({
  estimate,
  completed,
}: TaskPomodoroClocksProps) {
  const { t } = useI18n();
  if (estimate <= 0 && completed <= 0) return null;

  const visualCount = Math.min(
    Math.max(estimate, completed, 0),
    MAX_TASK_CLOCK_ICONS,
  );
  const overflow = Math.max(estimate, completed) > MAX_TASK_CLOCK_ICONS;

  return (
    <span
      className="task-pomodoro-clocks"
      title={t("clock.progress", {
        done: formatPomodoroAmount(completed),
        estimate,
      })}
      aria-label={t("clock.progressLabel", {
        done: formatPomodoroAmount(completed),
        estimate,
      })}
    >
      {Array.from({ length: visualCount }, (_, i) => {
        const done = i < completed;
        const planned = i < estimate;
        return (
          <span
            key={i}
            className={`task-clock${done ? " is-done" : ""}${
              planned && !done ? " is-planned" : ""
            }${!planned && done ? " is-extra" : ""}`}
          >
            <ClockGlyph filled={done} />
          </span>
        );
      })}
      <span className="task-pomodoro-ratio">
        {formatPomodoroAmount(completed)}/{estimate}
        {overflow ? "+" : ""}
      </span>
    </span>
  );
}
