import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Category, Task } from "../lib/api";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { CheckinWeekdayFields } from "./CheckinWeekdayFields";
import { encodeCheckinWeekdays, parseCheckinWeekdays } from "../lib/checkinSchedule";
import { OptionPicker } from "./OptionPicker";
import { formatDateTime } from "../lib/dateDisplay";
import { WEEKDAY_FULL } from "../lib/i18n";
import { formatPomodoroAmount } from "../lib/pomodoroTimer";
import {
  lunarDayLabel,
  lunarMonthLabel,
  parseIntervalDays,
  parseTaskRecurrence,
  recurrenceDraft,
  stampRecurrence,
  type CountDirection,
  type RecurrenceDraft,
} from "../lib/taskRecurrence";
import { CategoryPicker } from "./CategoryPicker";
import { ClockEstimatePicker } from "./ClockEstimate";
import { useI18n } from "./LocaleProvider";

export interface TaskDetailSave {
  title: string;
  category_id: string | null;
  estimate_pomodoros: number;
  notes: string;
  due_at: number | null;
  start_at: number | null;
  recurrence: string | null;
  checkin_weekdays?: string | null;
}

interface TaskDetailDialogProps {
  open: boolean;
  task: Task | null;
  categories: Category[];
  onClose: () => void;
  onSave: (input: TaskDetailSave) => Promise<void>;
  onCreateSubtask?: (title: string) => Promise<void>;
  onRequestCreateCategory?: () => void;
  onRequestEditCategory?: (category: Category) => void;
  /** Set after a category is created from this dialog. */
  pickedCategory?: { id: string; token: number } | null;
  checkinCategoryId?: string | null;
}

/** Convert unix ms → value for <input type="datetime-local">. */
type RepeatPeriod = "none" | "daily" | "interval" | "weekly" | "monthly" | "yearly" | "lunar-yearly";
type MonthMode = "day" | "workday" | "restday";

function englishOrdinal(day: number): string {
  const mod100 = day % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";
  return `${day}${suffix}`;
}

function toDatetimeLocalValue(ms: number | null | undefined): string {
  if (ms == null) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function TaskDetailDialog({
  open,
  task,
  categories,
  onClose,
  onSave,
  onCreateSubtask,
  onRequestCreateCategory,
  onRequestEditCategory,
  pickedCategory,
  checkinCategoryId = null,
}: TaskDetailDialogProps) {
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [estimate, setEstimate] = useState(0);
  const [notes, setNotes] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [period, setPeriod] = useState<RepeatPeriod>("none");
  const [intervalDays, setIntervalDays] = useState("1");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthMode, setMonthMode] = useState<MonthMode>("day");
  const [monthDays, setMonthDays] = useState<number[]>([1]);
  const [countDirection, setCountDirection] = useState<CountDirection>("forward");
  const [ordinals, setOrdinals] = useState<number[]>([1]);
  const [yearMonths, setYearMonths] = useState<number[]>([1]);
  const [yearDays, setYearDays] = useState<number[]>([1]);
  const [lunarMonths, setLunarMonths] = useState<number[]>([1]);
  const [lunarDays, setLunarDays] = useState<number[]>([5]);
  const [checkinEveryDay, setCheckinEveryDay] = useState(true);
  const [checkinDays, setCheckinDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subtaskOpen, setSubtaskOpen] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskBusy, setSubtaskBusy] = useState(false);
  const [subtaskError, setSubtaskError] = useState<string | null>(null);
  const seenCategoryToken = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const subtaskRef = useRef<HTMLDivElement>(null);
  const { locale, t } = useI18n();
  useDismissOnAndroidBack(open, () => {
    if (!busy && !subtaskBusy) onClose();
  }, rootRef);
  useDismissOnAndroidBack(subtaskOpen, () => {
    if (!subtaskBusy) setSubtaskOpen(false);
  }, subtaskRef);

  useEffect(() => {
    if (!open || !task) return;
    setTitle(task.title);
    setCategoryId(task.category_id);
    setEstimate(task.estimate_pomodoros ?? 0);
    setNotes(task.notes ?? "");
    setStartLocal(toDatetimeLocalValue(task.start_at));
    setDueLocal(toDatetimeLocalValue(task.due_at));
    const draft = recurrenceDraft(parseTaskRecurrence(task.recurrence));
    setIntervalDays(draft.kind === "interval" ? String(draft.days) : "1");
    if (draft.kind === "daily") {
      setPeriod("daily");
    } else if (draft.kind === "interval") {
      setPeriod("interval");
    } else if (draft.kind === "weekly") {
      setPeriod("weekly");
      setWeekdays(draft.weekdays);
    } else if (draft.kind === "monthly-day") {
      setPeriod("monthly");
      setMonthMode("day");
      setMonthDays(draft.days);
    } else if (draft.kind === "monthly-workday" || draft.kind === "monthly-restday") {
      setPeriod("monthly");
      setMonthMode(draft.kind === "monthly-workday" ? "workday" : "restday");
      setCountDirection(draft.direction);
      setOrdinals(draft.indexes);
    } else if (draft.kind === "yearly") {
      setPeriod("yearly");
      setYearMonths(draft.months);
      setYearDays(draft.days);
    } else if (draft.kind === "lunar-yearly") {
      setPeriod("lunar-yearly");
      setLunarMonths(draft.months);
      setLunarDays(draft.days);
    } else {
      setPeriod("none");
    }
    const checkinDays = parseCheckinWeekdays(task.checkin_weekdays);
    setCheckinEveryDay(checkinDays == null);
    setCheckinDays(checkinDays ?? [1, 2, 3, 4, 5, 6, 0]);
    setBusy(false);
    setError(null);
    setSubtaskOpen(false);
    setSubtaskTitle("");
    setSubtaskBusy(false);
    setSubtaskError(null);
  }, [open, task]);

  useEffect(() => {
    if (!open) return;
    seenCategoryToken.current = pickedCategory?.token ?? 0;
  }, [open, task?.id]);

  useEffect(() => {
    if (!open || !pickedCategory) return;
    if (pickedCategory.token === seenCategoryToken.current) return;
    seenCategoryToken.current = pickedCategory.token;
    setCategoryId(pickedCategory.id);
  }, [open, pickedCategory]);

  if (!open || !task) return null;

  function repeatDraft(): RecurrenceDraft | null {
    if (period === "daily") return { kind: "daily" };
    if (period === "interval") {
      const days = parseIntervalDays(intervalDays);
      if (days == null) return null;
      return { kind: "interval", days };
    }
    if (period === "weekly") return { kind: "weekly", weekdays };
    if (period === "monthly" && monthMode === "day") return { kind: "monthly-day", days: monthDays };
    if (period === "monthly" && monthMode === "workday") {
      return { kind: "monthly-workday", direction: countDirection, indexes: ordinals };
    }
    if (period === "monthly" && monthMode === "restday") {
      return { kind: "monthly-restday", direction: countDirection, indexes: ordinals };
    }
    if (period === "yearly") return { kind: "yearly", months: yearMonths, days: yearDays };
    if (period === "lunar-yearly") {
      return { kind: "lunar-yearly", months: lunarMonths, days: lunarDays };
    }
    return { kind: "none" };
  }

  const dayOptions = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return { value: String(day), label: t("detail.monthDayN", { day }) };
  });
  const ordinalOptions = Array.from({ length: 31 }, (_, index) => {
    const n = index + 1;
    const shown = locale === "en" ? englishOrdinal(n) : n;
    return { value: String(n), label: t("detail.ordinal", { n: shown }) };
  });
  const showOrdinal = period === "monthly" && monthMode !== "day";

  const isSubtask = !!task.parent_id;
  const showCheckinDays =
    !isSubtask && !!checkinCategoryId && categoryId === checkinCategoryId;
  const category = categoryId
    ? categories.find((item) => item.id === categoryId)
    : null;
  const completed = task.completed_pomodoros ?? 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || busy) return;
    const draft = repeatDraft();
    if (!draft) {
      setError(t("detail.intervalInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: nextTitle,
        category_id: isSubtask ? task!.category_id : categoryId,
        estimate_pomodoros: estimate,
        notes,
        start_at: fromDatetimeLocalValue(startLocal),
        due_at: fromDatetimeLocalValue(dueLocal),
        recurrence: stampRecurrence(task!.recurrence, draft),
        ...(showCheckinDays
          ? { checkin_weekdays: encodeCheckinWeekdays(checkinEveryDay, checkinDays) }
          : {}),
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card task-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="task-detail-title">{t("detail.title")}</h2>
        <form className="task-detail-form" onSubmit={handleSubmit}>
          <div className="task-detail-scroll">
          <label className="field">
            <span>{t("common.taskName")}</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </label>

          <div className="field">
            <span>{t("common.category")}</span>
            {isSubtask ? (
              <p className="task-detail-meta">
                {category ? category.name : t("common.uncategorized")}
                <span className="task-detail-hint">{t("detail.followsParent")}</span>
              </p>
            ) : (
              <CategoryPicker
                categories={categories}
                value={categoryId}
                disabled={busy}
                onChange={setCategoryId}
                onRequestCreate={onRequestCreateCategory}
                onRequestEdit={onRequestEditCategory}
              />
            )}
          </div>

          <div className="field">
            <span>{t("detail.estimate")}</span>
            <ClockEstimatePicker
              value={estimate}
              onChange={setEstimate}
              disabled={busy}
            />
            {completed > 0 && (
              <p className="task-detail-meta">
                {t("detail.completedCount", { count: formatPomodoroAmount(completed) })}
              </p>
            )}
          </div>

          <div className="field">
            <span>{t("detail.created")}</span>
            <p className="task-detail-meta">{formatDateTime(task.created_at, locale)}</p>
          </div>

          <label className="field">
            <span>{t("detail.start")}</span>
            <div className="task-detail-due-row">
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                disabled={busy}
              />
              {startLocal && (
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setStartLocal("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </label>

          <label className="field">
            <span>{t("detail.due")}</span>
            <div className="task-detail-due-row">
              <input
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
                disabled={busy}
              />
              {dueLocal && (
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setDueLocal("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </label>

          <div className="field">
            <span>{t("detail.repeat")}</span>
            <div className="task-detail-repeat-row">
              <OptionPicker
                value={period}
                disabled={busy}
                ariaLabel={t("detail.repeat")}
                options={[
                  { value: "none", label: t("detail.repeatNone") },
                  { value: "daily", label: t("detail.repeatDaily") },
                  { value: "interval", label: t("detail.repeatInterval") },
                  { value: "weekly", label: t("detail.repeatWeekly") },
                  { value: "monthly", label: t("detail.repeatMonthly") },
                  { value: "yearly", label: t("detail.repeatYearlyPeriod") },
                  { value: "lunar-yearly", label: t("detail.repeatLunarYearly") },
                ]}
                onChange={setPeriod}
              />
              {period === "interval" && (
                <label className="task-detail-interval">
                  <input
                    value={intervalDays}
                    inputMode="numeric"
                    aria-label={t("detail.repeatInterval")}
                    disabled={busy}
                    onChange={(event) =>
                      setIntervalDays(event.target.value.replace(/\D/g, ""))
                    }
                  />
                  <span>{t("detail.intervalDay")}</span>
                </label>
              )}
              {period === "weekly" && (
                <OptionPicker
                  multiple
                  values={weekdays.map(String)}
                  disabled={busy}
                  ariaLabel={t("detail.repeatWeekly")}
                  options={[1, 2, 3, 4, 5, 6, 0].map((day) => ({
                    value: String(day),
                    label: WEEKDAY_FULL[locale][day] ?? "",
                  }))}
                  onValuesChange={(values) => setWeekdays(values.map(Number))}
                />
              )}
              {period === "monthly" && (
                <OptionPicker
                  value={monthMode}
                  disabled={busy}
                  ariaLabel={t("detail.repeatMonthly")}
                  options={[
                    { value: "day", label: t("detail.monthModeDay") },
                    { value: "workday", label: t("detail.monthModeWorkday") },
                    { value: "restday", label: t("detail.monthModeRestday") },
                  ]}
                  onChange={setMonthMode}
                />
              )}
              {period === "yearly" && (
                <OptionPicker
                  multiple
                  values={yearMonths.map(String)}
                  disabled={busy}
                  ariaLabel={t("detail.repeatYearly")}
                  options={Array.from({ length: 12 }, (_, index) => {
                    const month = index + 1;
                    return { value: String(month), label: t("detail.solarMonthN", { month }) };
                  })}
                  onValuesChange={(values) => setYearMonths(values.map(Number))}
                />
              )}
              {period === "lunar-yearly" && (
                <OptionPicker
                  multiple
                  values={lunarMonths.map(String)}
                  disabled={busy}
                  ariaLabel={t("detail.lunarMonth")}
                  options={Array.from({ length: 12 }, (_, index) => {
                    const month = index + 1;
                    return { value: String(month), label: lunarMonthLabel(month, locale) };
                  })}
                  onValuesChange={(values) => setLunarMonths(values.map(Number))}
                />
              )}
              {period === "monthly" && monthMode === "day" && (
                <OptionPicker
                  multiple
                  values={monthDays.map(String)}
                  disabled={busy}
                  ariaLabel={t("detail.repeatMonthlyDay")}
                  options={dayOptions}
                  onValuesChange={(values) => setMonthDays(values.map(Number))}
                />
              )}
              {showOrdinal && (
                <OptionPicker
                  value={countDirection}
                  disabled={busy}
                  ariaLabel={t("detail.countForward")}
                  options={[
                    { value: "forward", label: t("detail.countForward") },
                    { value: "backward", label: t("detail.countBackward") },
                  ]}
                  onChange={setCountDirection}
                />
              )}
              {period === "yearly" && (
                <OptionPicker
                  multiple
                  values={yearDays.map(String)}
                  disabled={busy}
                  ariaLabel={t("detail.repeatYearly")}
                  options={dayOptions}
                  onValuesChange={(values) => setYearDays(values.map(Number))}
                />
              )}
              {period === "lunar-yearly" && (
                <OptionPicker
                  multiple
                  values={lunarDays.map(String)}
                  disabled={busy}
                  ariaLabel={t("detail.lunarDay")}
                  options={Array.from({ length: 30 }, (_, index) => {
                    const day = index + 1;
                    return { value: String(day), label: lunarDayLabel(day, locale) };
                  })}
                  onValuesChange={(values) => setLunarDays(values.map(Number))}
                />
              )}
              {showOrdinal && (
                <OptionPicker
                  multiple
                  values={ordinals.map(String)}
                  disabled={busy}
                  ariaLabel={t("detail.ordinal", { n: ordinals.join(",") })}
                  options={ordinalOptions}
                  onValuesChange={(values) => setOrdinals(values.map(Number))}
                />
              )}
            </div>
            {period === "interval" ? (
              <p className="task-detail-meta">{t("detail.intervalHint")}</p>
            ) : (
              period !== "none" && (
                <p className="task-detail-meta">{t("detail.repeatHint")}</p>
              )
            )}
          </div>

          {showCheckinDays && (
            <div className="field">
              <span>{t("checkin.schedule")}</span>
              <CheckinWeekdayFields
                everyDay={checkinEveryDay}
                days={checkinDays}
                disabled={busy}
                onEveryDayChange={setCheckinEveryDay}
                onDaysChange={setCheckinDays}
              />
              <p className="task-detail-meta">{t("checkin.scheduleHint")}</p>
            </div>
          )}

          <label className="field">
            <span>{t("detail.notes")}</span>
            <textarea
              className="task-detail-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("detail.notesPlaceholder")}
              rows={6}
              disabled={busy}
            />
          </label>
          </div>

          {error && <p className="error-banner">{error}</p>}

          <div className="modal-actions">
            {onCreateSubtask && (
              <button
                type="button"
                className="secondary-btn modal-action-start"
                onClick={() => {
                  setSubtaskTitle("");
                  setSubtaskError(null);
                  setSubtaskOpen(true);
                }}
                disabled={busy || subtaskBusy}
              >
                {t("detail.createSubtask")}
              </button>
            )}
            <button
              type="button"
              className="secondary-btn"
              onClick={onClose}
              disabled={busy || subtaskBusy}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="primary-btn"
              disabled={busy || subtaskBusy || !title.trim()}
            >
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>

      {subtaskOpen && (
        <div
          ref={subtaskRef}
          className="modal-backdrop"
          role="presentation"
          onClick={(e) => {
            e.stopPropagation();
            if (!subtaskBusy) setSubtaskOpen(false);
          }}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-subtask-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-subtask-title">{t("detail.createSubtask")}</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const title = subtaskTitle.trim();
                if (!title || !onCreateSubtask || subtaskBusy) return;
                setSubtaskBusy(true);
                setSubtaskError(null);
                void onCreateSubtask(title)
                  .then(() => {
                    setSubtaskOpen(false);
                    setSubtaskTitle("");
                  })
                  .catch((err) => setSubtaskError(String(err)))
                  .finally(() => setSubtaskBusy(false));
              }}
            >
              <label className="field">
                <span>{t("common.taskName")}</span>
                <input
                  value={subtaskTitle}
                  onChange={(e) => setSubtaskTitle(e.target.value)}
                  placeholder={t("detail.subtaskName")}
                  autoFocus
                  disabled={subtaskBusy}
                />
              </label>
              {subtaskError && <p className="error-banner">{subtaskError}</p>}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={subtaskBusy}
                  onClick={() => setSubtaskOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={subtaskBusy || !subtaskTitle.trim()}
                >
                  {t("common.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
