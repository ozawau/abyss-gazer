import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_POMODORO_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  getActiveDataDir,
  getDbPath,
  getDefaultDataDir,
  createCategory,
  getPomodoroSettings,
  getSystemSettings,
  listCategories,
  persistSoundFile,
  pickDirectory,
  PomodoroSettings,
  setDataDirectory,
  setPomodoroSettings,
  setSystemSettings,
  SyncIntervalMinutes,
  SyncMethod,
  SystemSettings,
  WeekStartsOn,
  type Category,
  type LanguagePreference,
} from "../lib/api";
import {
  SILENT_SOUND,
  forgetCachedSound,
  isSilentSound,
  playPomodoroEndChime,
} from "../lib/pomodoroChime";
import { APP_VERSION, RELEASE_NOTES } from "../lib/changelog";
import { publishSystemSettings, useI18n } from "./LocaleProvider";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { ToggleSwitch } from "./ToggleSwitch";
import { isAndroidDevice, useNarrowViewport } from "../lib/viewport";

type SettingsSection = "pomodoro" | "calendar" | "tasks" | "system" | "about";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onPomodoroSettingsChange: (settings: PomodoroSettings) => void;
  onSystemSettingsChange: (settings: SystemSettings) => void;
  onDataPathChange: (dbPath: string) => void;
}

function SettingsSectionIcon({
  id,
}: {
  id: "pomodoro" | "calendar" | "tasks" | "system" | "about";
}) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg className="settings-nav-icon" viewBox="0 0 24 24" aria-hidden>
      {id === "pomodoro" && (
        <>
          <path d="M17 13H12V8" {...stroke} />
          <path d="M5 3.5L7 2" {...stroke} />
          <path d="M19 3.5L17 2" {...stroke} />
          <path
            d="M12 22C16.9706 22 21 17.9706 21 13C21 8.02944 16.9706 4 12 4C7.02944 4 3 8.02944 3 13C3 17.9706 7.02944 22 12 22Z"
            {...stroke}
          />
        </>
      )}
      {id === "calendar" && (
        <>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" {...stroke} />
          <path d="M3.5 10h17" {...stroke} />
          <path d="M8 3.5v3M16 3.5v3" {...stroke} />
        </>
      )}
      {id === "tasks" && (
        <>
          <path d="M9 6h12M9 12h12M9 18h12" {...stroke} />
          <path d="M5 6h.01M5 12h.01M5 18h.01" {...stroke} />
        </>
      )}
      {id === "system" && (
        <>
          <path
            d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
            {...stroke}
          />
          <path
            d="M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155C16.6969 18.8313 18 20 18 20L20 18L18.5159 16.2494L19.6139 13.598L21.9999 12.9772L22 11L19.6224 10.3954Z"
            {...stroke}
          />
        </>
      )}
      {id === "about" && (
        <>
          <circle cx="12" cy="12" r="9" {...stroke} />
          <path d="M12 11v6" {...stroke} />
          <path d="M12 8h.01" {...stroke} />
        </>
      )}
    </svg>
  );
}

function clampMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(180, Math.round(value));
}

function clampInterval(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(99, Math.round(value));
}

export function SettingsDialog({
  open,
  onClose,
  onPomodoroSettingsChange,
  onSystemSettingsChange,
  onDataPathChange,
}: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>("pomodoro");
  const [settings, setSettings] = useState<PomodoroSettings>(
    DEFAULT_POMODORO_SETTINGS,
  );
  const [system, setSystem] = useState<SystemSettings>(DEFAULT_SYSTEM_SETTINGS);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeDataDir, setActiveDataDir] = useState("");
  const [defaultDataDir, setDefaultDataDir] = useState("");
  const [creatingCheckinCategory, setCreatingCheckinCategory] = useState(false);
  const [creatingNoteCategory, setCreatingNoteCategory] = useState(false);
  const [newCheckinCategoryName, setNewCheckinCategoryName] = useState("");
  const [newNoteCategoryName, setNewNoteCategoryName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const narrow = useNarrowViewport();
  const android = isAndroidDevice();
  const iconNav = android && narrow;
  useDismissOnAndroidBack(open, () => {
    void requestClose();
  }, rootRef);
  const weekStartOptions: { value: WeekStartsOn; label: string }[] = [
    { value: 1, label: t("settings.weekday.mon") },
    { value: 2, label: t("settings.weekday.tue") },
    { value: 3, label: t("settings.weekday.wed") },
    { value: 4, label: t("settings.weekday.thu") },
    { value: 5, label: t("settings.weekday.fri") },
    { value: 6, label: t("settings.weekday.sat") },
    { value: 0, label: t("settings.weekday.sun") },
  ];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    Promise.all([
      getPomodoroSettings(),
      getSystemSettings(),
      getActiveDataDir(),
      getDefaultDataDir(),
      listCategories(),
    ])
      .then(([pomodoro, systemSettings, activeDir, defaultDir, categoryRows]) => {
        if (cancelled) return;
        setSettings({ ...DEFAULT_POMODORO_SETTINGS, ...pomodoro });
        setSystem({ ...DEFAULT_SYSTEM_SETTINGS, ...systemSettings });
        setActiveDataDir(activeDir);
        setDefaultDataDir(defaultDir);
        setCategories(categoryRows);
        setNewCheckinCategoryName(t("settings.defaultCheckinCategoryName"));
        setNewNoteCategoryName(t("settings.defaultNoteCategoryName"));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    function refreshLaunchAtLogin() {
      void getSystemSettings()
        .then((saved) => {
          if (cancelled) return;
          setSystem((prev) =>
            prev.launchAtLogin === saved.launchAtLogin
              ? prev
              : { ...prev, launchAtLogin: saved.launchAtLogin },
          );
        })
        .catch(() => {
          /* keep the switch as it is */
        });
    }
    window.addEventListener("focus", refreshLaunchAtLogin);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshLaunchAtLogin);
    };
  }, [open]);

  if (!open) return null;

  async function persistPomodoro(next: PomodoroSettings) {
    setBusy(true);
    setError(null);
    try {
      const saved = {
        ...DEFAULT_POMODORO_SETTINGS,
        ...(await setPomodoroSettings(next)),
      };
      setSettings(saved);
      onPomodoroSettingsChange(saved);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function persistSystem(next: SystemSettings) {
    setBusy(true);
    setError(null);
    try {
      const saved = await setSystemSettings(next);
      setSystem(saved);
      onSystemSettingsChange(saved);
    } catch (err) {
      setSystem(system);
      publishSystemSettings(system);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function patchPomodoro(partial: Partial<PomodoroSettings>) {
    const next = { ...settings, ...partial };
    setSettings(next);
    void persistPomodoro(next);
  }

  function patchSystem(partial: Partial<SystemSettings>) {
    const next = { ...system, ...partial };
    setSystem(next);
    if (partial.language) publishSystemSettings(next);
    void persistSystem(next);
  }

  function normalizedPomodoro(state: PomodoroSettings): PomodoroSettings {
    return {
      ...state,
      focusMinutes: clampMinutes(state.focusMinutes, 25),
      shortBreakMinutes: clampMinutes(state.shortBreakMinutes, 5),
      longBreakMinutes: clampMinutes(state.longBreakMinutes, 15),
      longBreakInterval: clampInterval(state.longBreakInterval),
    };
  }

  function commitNumber(
    key: keyof PomodoroSettings,
    raw: string,
    clamp: (n: number) => number,
  ) {
    const parsed = Number(raw);
    const value = clamp(Number.isFinite(parsed) ? parsed : Number(settings[key]));
    patchPomodoro({ [key]: value } as Partial<PomodoroSettings>);
  }

  async function requestClose() {
    if (busy) return;
    const next = normalizedPomodoro(settings);
    if (
      next.focusMinutes !== settings.focusMinutes ||
      next.shortBreakMinutes !== settings.shortBreakMinutes ||
      next.longBreakMinutes !== settings.longBreakMinutes ||
      next.longBreakInterval !== settings.longBreakInterval
    ) {
      setSettings(next);
    }
    try {
      await persistPomodoro(next);
    } catch {
      return;
    }
    onClose();
  }

  async function chooseFolder(
    title: string,
    defaultPath?: string,
  ): Promise<string | null> {
    if (/Android/i.test(navigator.userAgent)) {
      return pickDirectory();
    }
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title,
      defaultPath,
    });
    if (selected == null || Array.isArray(selected)) return null;
    return selected;
  }

  async function chooseDataDir() {
    try {
      const selected = await chooseFolder(
        t("settings.chooseDataDir"),
        activeDataDir || defaultDataDir || undefined,
      );
      if (selected == null) return;
      setBusy(true);
      setError(null);
      const saved = await setDataDirectory(selected);
      setSystem(saved);
      onSystemSettingsChange(saved);
      const [nextDir, path] = await Promise.all([
        getActiveDataDir(),
        getDbPath(),
      ]);
      setActiveDataDir(nextDir);
      onDataPathChange(path);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  function soundFileName(path: string | null): string {
    if (!path) return t("settings.defaultChime");
    if (isSilentSound(path)) return t("settings.silentChime");
    const name = path.split(/[/\\]/).pop();
    return name || path;
  }

  async function chooseSound(key: "focusEndSound" | "breakEndSound") {
    try {
      const selected = await openDialog({
        multiple: false,
        title: t("settings.chooseSound"),
        filters: [{ name: t("settings.audio"), extensions: ["mp3", "wav"] }],
      });
      if (selected == null || Array.isArray(selected)) return;
      forgetCachedSound(settings[key]);
      const stored = android ? await persistSoundFile(selected) : selected;
      patchPomodoro({ [key]: stored } as Partial<PomodoroSettings>);
    } catch (err) {
      setError(String(err));
    }
  }

  async function previewSound(kind: "focus" | "break") {
    const path =
      kind === "focus" ? settings.focusEndSound : settings.breakEndSound;
    if (isSilentSound(path)) return;
    setError(null);
    try {
      await playPomodoroEndChime(kind, path, { fallbackToDefault: false });
    } catch (err) {
      forgetCachedSound(path);
      setError(String(err));
    }
  }

  function resetSound(key: "focusEndSound" | "breakEndSound") {
    forgetCachedSound(settings[key]);
    patchPomodoro({ [key]: null } as Partial<PomodoroSettings>);
  }

  function muteSound(key: "focusEndSound" | "breakEndSound") {
    forgetCachedSound(settings[key]);
    patchPomodoro({ [key]: SILENT_SOUND } as Partial<PomodoroSettings>);
  }

  async function createAndAssignCategory(
    role: "checkin" | "note",
    name: string,
  ) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const category = await createCategory(trimmed, "#2563eb");
      setCategories((prev) =>
        [...prev, category].sort((a, b) => a.name.localeCompare(b.name, "zh")),
      );
      const patch =
        role === "checkin"
          ? { checkinCategoryId: category.id }
          : { noteCategoryId: category.id };
      const next = { ...system, ...patch };
      setSystem(next);
      const saved = await setSystemSettings(next);
      setSystem(saved);
      onSystemSettingsChange(saved);
      if (role === "checkin") setCreatingCheckinCategory(false);
      else setCreatingNoteCategory(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function chooseBackupDir() {
    try {
      const selected = await chooseFolder(
        t("settings.chooseBackup"),
        system.localBackupDir || undefined,
      );
      if (selected == null) return;
      patchSystem({ localBackupDir: selected });
    } catch (err) {
      setError(String(err));
    }
  }

  const breaksOff = !settings.breaksEnabled;
  const longBreakOff = breaksOff || !settings.longBreakEnabled;
  const syncOff = !system.syncEnabled;

  return (
    <div ref={rootRef} className="modal-backdrop" role="presentation" onClick={() => void requestClose()}>
      <div
        className="modal-card settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-dialog-header">
          <h2 id="settings-dialog-title">{t("settings.title")}</h2>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => void requestClose()}
            disabled={busy}
          >
            {t("common.close")}
          </button>
        </div>

        <div className="settings-dialog-body">
          <nav className="settings-dialog-nav" aria-label={t("settings.nav")}>
            {(
              [
                ["pomodoro", "settings.pomodoro"],
                ["calendar", "settings.calendar"],
                ["tasks", "settings.tasks"],
                ["system", "settings.system"],
                ["about", "settings.about"],
              ] as const
            ).map(([id, labelKey]) => {
              const label = t(labelKey);
              return (
                <button
                  key={id}
                  type="button"
                  className={`settings-nav-item${section === id ? " is-active" : ""}`}
                  onClick={() => setSection(id)}
                  aria-label={label}
                  title={iconNav ? label : undefined}
                >
                  {iconNav ? <SettingsSectionIcon id={id} /> : label}
                </button>
              );
            })}
          </nav>

          <div className="settings-dialog-content">
            {section === "pomodoro" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>{t("settings.pomodoro")}</h3>
                  <p>{t("settings.pomodoroHint")}</p>
                </header>

                <label className="settings-row">
                  <span className="settings-row-label">{t("settings.focusMinutes")}</span>
                  <span className="settings-row-control settings-input-suffix">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={settings.focusMinutes}
                      disabled={busy}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          focusMinutes: Number(e.target.value),
                        }))
                      }
                      onBlur={(e) =>
                        commitNumber("focusMinutes", e.target.value, (n) =>
                          clampMinutes(n, 25),
                        )
                      }
                    />
                    <span>{t("settings.minutes")}</span>
                  </span>
                </label>

                <div className="settings-row">
                  <span className="settings-row-label">{t("settings.breaks")}</span>
                  <ToggleSwitch
                    label={t("settings.breaks")}
                    checked={settings.breaksEnabled}
                    disabled={busy}
                    onChange={(checked) =>
                      patchPomodoro({ breaksEnabled: checked })
                    }
                  />
                </div>

                <div
                  className={`settings-group${breaksOff ? " is-disabled" : ""}`}
                >
                  <label className="settings-row">
                    <span className="settings-row-label">{t("settings.shortBreak")}</span>
                    <span className="settings-row-control settings-input-suffix">
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={settings.shortBreakMinutes}
                        disabled={busy || breaksOff}
                        onChange={(e) =>
                          setSettings((s) => ({
                            ...s,
                            shortBreakMinutes: Number(e.target.value),
                          }))
                        }
                        onBlur={(e) =>
                          commitNumber(
                            "shortBreakMinutes",
                            e.target.value,
                            (n) => clampMinutes(n, 5),
                          )
                        }
                      />
                      <span>{t("settings.minutes")}</span>
                    </span>
                  </label>

                  <div className="settings-row">
                    <span className="settings-row-label">{t("settings.longBreakToggle")}</span>
                    <ToggleSwitch
                      label={t("settings.longBreakToggle")}
                      checked={settings.longBreakEnabled}
                      disabled={busy || breaksOff}
                      onChange={(checked) =>
                        patchPomodoro({ longBreakEnabled: checked })
                      }
                    />
                  </div>

                  <div
                    className={`settings-group${
                      longBreakOff ? " is-disabled" : ""
                    }`}
                  >
                    <label className="settings-row">
                      <span className="settings-row-label">{t("settings.longBreak")}</span>
                      <span className="settings-row-control settings-input-suffix">
                        <input
                          type="number"
                          min={1}
                          max={180}
                          value={settings.longBreakMinutes}
                          disabled={busy || longBreakOff}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              longBreakMinutes: Number(e.target.value),
                            }))
                          }
                          onBlur={(e) =>
                            commitNumber(
                              "longBreakMinutes",
                              e.target.value,
                              (n) => clampMinutes(n, 15),
                            )
                          }
                        />
                        <span>{t("settings.minutes")}</span>
                      </span>
                    </label>

                    <label className="settings-row">
                      <span className="settings-row-label">{t("settings.longBreakEvery")}</span>
                      <span className="settings-row-control settings-input-suffix">
                        <input
                          type="number"
                          min={1}
                          max={99}
                          value={settings.longBreakInterval}
                          disabled={busy || longBreakOff}
                          onChange={(e) =>
                            setSettings((s) => ({
                              ...s,
                              longBreakInterval: Number(e.target.value),
                            }))
                          }
                          onBlur={(e) =>
                            commitNumber(
                              "longBreakInterval",
                              e.target.value,
                              clampInterval,
                            )
                          }
                        />
                        <span>{t("settings.pomodoros")}</span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-row-label">
                    {t("settings.autoFocus")}
                  </span>
                  <ToggleSwitch
                    label={t("settings.autoFocus")}
                    checked={settings.autoStartFocus}
                    disabled={busy}
                    onChange={(checked) =>
                      patchPomodoro({ autoStartFocus: checked })
                    }
                  />
                </div>

                <div className="settings-row">
                  <span className="settings-row-label">
                    {t("settings.autoBreak")}
                  </span>
                  <ToggleSwitch
                    label={t("settings.autoBreak")}
                    checked={settings.autoStartBreak}
                    disabled={busy || breaksOff}
                    onChange={(checked) =>
                      patchPomodoro({ autoStartBreak: checked })
                    }
                  />
                </div>

                {android && (
                  <>
                    <div className="settings-row">
                      <span className="settings-row-label">
                        {t("settings.focusEndVibrate")}
                      </span>
                      <ToggleSwitch
                        label={t("settings.focusEndVibrate")}
                        checked={settings.focusEndVibrate}
                        disabled={busy}
                        onChange={(checked) =>
                          patchPomodoro({ focusEndVibrate: checked })
                        }
                      />
                    </div>
                    <div className="settings-row">
                      <span className="settings-row-label">
                        {t("settings.breakEndVibrate")}
                      </span>
                      <ToggleSwitch
                        label={t("settings.breakEndVibrate")}
                        checked={settings.breakEndVibrate}
                        disabled={busy || breaksOff}
                        onChange={(checked) =>
                          patchPomodoro({ breakEndVibrate: checked })
                        }
                      />
                    </div>
                  </>
                )}

                <div className="settings-row settings-row-stack">
                  <span className="settings-row-label">{t("settings.focusSound")}</span>
                  <div className="settings-path-block">
                    <code className="settings-path-value">
                      {soundFileName(settings.focusEndSound)}
                    </code>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || isSilentSound(settings.focusEndSound)}
                      onClick={() => void previewSound("focus")}
                    >
                      {t("settings.preview")}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => void chooseSound("focusEndSound")}
                    >
                      {t("settings.choose")}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || settings.focusEndSound == null}
                      onClick={() => resetSound("focusEndSound")}
                    >
                      {t("settings.defaultSound")}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || isSilentSound(settings.focusEndSound)}
                      onClick={() => muteSound("focusEndSound")}
                    >
                      {t("settings.noneSound")}
                    </button>
                  </div>
                </div>

                <div className="settings-row settings-row-stack">
                  <span className="settings-row-label">{t("settings.breakSound")}</span>
                  <div className="settings-path-block">
                    <code className="settings-path-value">
                      {soundFileName(settings.breakEndSound)}
                    </code>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || isSilentSound(settings.breakEndSound)}
                      onClick={() => void previewSound("break")}
                    >
                      {t("settings.preview")}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => void chooseSound("breakEndSound")}
                    >
                      {t("settings.choose")}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || settings.breakEndSound == null}
                      onClick={() => resetSound("breakEndSound")}
                    >
                      {t("settings.defaultSound")}
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || isSilentSound(settings.breakEndSound)}
                      onClick={() => muteSound("breakEndSound")}
                    >
                      {t("settings.noneSound")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === "calendar" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>{t("settings.calendar")}</h3>
                  <p>{t("settings.calendarHint")}</p>
                </header>

                <label className="settings-row">
                  <span className="settings-row-label">{t("settings.weekStarts")}</span>
                  <select
                    className="settings-select"
                    value={system.weekStartsOn}
                    disabled={busy}
                    onChange={(e) =>
                      patchSystem({
                        weekStartsOn: Number(e.target.value) as WeekStartsOn,
                      })
                    }
                  >
                    {weekStartOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {section === "tasks" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>{t("settings.tasks")}</h3>
                  <p>{t("settings.tasksHint")}</p>
                </header>

                <div className="settings-group">
                  <label className="settings-row">
                    <span className="settings-row-label">{t("settings.checkinCategory")}</span>
                    <select
                      className="settings-select"
                      value={system.checkinCategoryId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        patchSystem({
                          checkinCategoryId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">{t("settings.taskCategoryUnset")}</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="settings-field-hint">{t("settings.checkinCategoryHint")}</p>
                  {creatingCheckinCategory ? (
                    <div className="settings-path-block">
                      <input
                        type="text"
                        className="settings-text-input"
                        value={newCheckinCategoryName}
                        disabled={busy}
                        placeholder={t("settings.newCategoryName")}
                        onChange={(e) => setNewCheckinCategoryName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={busy || !newCheckinCategoryName.trim()}
                        onClick={() =>
                          void createAndAssignCategory("checkin", newCheckinCategoryName)
                        }
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={busy}
                        onClick={() => setCreatingCheckinCategory(false)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => setCreatingCheckinCategory(true)}
                    >
                      {t("settings.createCheckinCategory")}
                    </button>
                  )}
                </div>

                <div className="settings-group">
                  <label className="settings-row">
                    <span className="settings-row-label">{t("settings.noteCategory")}</span>
                    <select
                      className="settings-select"
                      value={system.noteCategoryId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        patchSystem({
                          noteCategoryId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">{t("settings.taskCategoryUnset")}</option>
                      {categories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="settings-field-hint">{t("settings.noteCategoryHint")}</p>
                  {creatingNoteCategory ? (
                    <div className="settings-path-block">
                      <input
                        type="text"
                        className="settings-text-input"
                        value={newNoteCategoryName}
                        disabled={busy}
                        placeholder={t("settings.newCategoryName")}
                        onChange={(e) => setNewNoteCategoryName(e.target.value)}
                      />
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={busy || !newNoteCategoryName.trim()}
                        onClick={() =>
                          void createAndAssignCategory("note", newNoteCategoryName)
                        }
                      >
                        {t("common.confirm")}
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        disabled={busy}
                        onClick={() => setCreatingNoteCategory(false)}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => setCreatingNoteCategory(true)}
                    >
                      {t("settings.createNoteCategory")}
                    </button>
                  )}
                </div>
              </div>
            )}

            {section === "system" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>{t("settings.system")}</h3>
                  <p>{t("settings.systemHint")}</p>
                </header>

                <label className="settings-row">
                  <span className="settings-row-label">{t("settings.language")}</span>
                  <select
                    className="settings-select"
                    value={system.language ?? "system"}
                    disabled={busy}
                    onChange={(e) =>
                      patchSystem({
                        language: e.target.value as LanguagePreference,
                      })
                    }
                  >
                    <option value="system">{t("settings.followSystem")}</option>
                    <option value="zh">{t("settings.chinese")}</option>
                    <option value="en">{t("settings.english")}</option>
                  </select>
                </label>

                <div className="settings-row">
                  <span className="settings-row-label">{t("settings.launchAtLogin")}</span>
                  <ToggleSwitch
                    label={t("settings.launchAtLogin")}
                    checked={system.launchAtLogin}
                    disabled={busy}
                    onChange={(checked) =>
                      patchSystem({ launchAtLogin: checked })
                    }
                  />
                </div>

                <div className="settings-row settings-row-stack">
                  <span className="settings-row-label">{t("settings.dataDir")}</span>
                  <div className="settings-path-block">
                    <code className="settings-path-value">
                      {activeDataDir || defaultDataDir || "—"}
                    </code>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => void chooseDataDir()}
                    >
                      {t("settings.chooseDir")}
                    </button>
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-row-label">{t("settings.sync")}</span>
                  <ToggleSwitch
                    label={t("settings.sync")}
                    checked={system.syncEnabled}
                    disabled={busy}
                    onChange={(checked) =>
                      patchSystem({ syncEnabled: checked })
                    }
                  />
                </div>

                {!android && (
                  <div
                    className={`settings-row settings-row-stack${syncOff ? " is-disabled" : ""}`}
                  >
                    <div className="settings-row">
                      <span className="settings-row-label">
                        {t("settings.syncOnDataChange")}
                      </span>
                      <ToggleSwitch
                        label={t("settings.syncOnDataChange")}
                        checked={system.syncOnDataChange}
                        disabled={busy || syncOff}
                        onChange={(checked) =>
                          patchSystem({ syncOnDataChange: checked })
                        }
                      />
                    </div>
                    <p className="settings-field-hint">
                      {t("settings.syncOnDataChangeHint")}
                    </p>
                  </div>
                )}

                <div
                  className={`settings-group${syncOff ? " is-disabled" : ""}`}
                >
                  <label className="settings-row">
                    <span className="settings-row-label">{t("settings.syncMethod")}</span>
                    <select
                      className="settings-select"
                      value={system.syncMethod}
                      disabled={busy || syncOff}
                      onChange={(e) =>
                        patchSystem({
                          syncMethod: e.target.value as SyncMethod,
                        })
                      }
                    >
                      <option value="local">{t("settings.localDisk")}</option>
                      <option value="git">Git</option>
                    </select>
                  </label>

                  <label className="settings-row">
                    <span className="settings-row-label">{t("settings.interval")}</span>
                    <select
                      className="settings-select"
                      value={system.syncIntervalMinutes}
                      disabled={busy || syncOff}
                      onChange={(e) =>
                        patchSystem({
                          syncIntervalMinutes: Number(
                            e.target.value,
                          ) as SyncIntervalMinutes,
                        })
                      }
                    >
                      <option value={5}>{t("settings.minutesCount", { count: 5 })}</option>
                      <option value={10}>{t("settings.minutesCount", { count: 10 })}</option>
                      <option value={30}>{t("settings.minutesCount", { count: 30 })}</option>
                    </select>
                  </label>

                  {system.syncMethod === "local" && (
                    <div className="settings-row settings-row-stack">
                      <span className="settings-row-label">{t("settings.backupDir")}</span>
                      <div className="settings-path-block">
                        <code className="settings-path-value">
                          {system.localBackupDir || t("settings.backupUnset")}
                        </code>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={busy || syncOff}
                          onClick={() => void chooseBackupDir()}
                        >
                          {t("settings.chooseDir")}
                        </button>
                      </div>
                    </div>
                  )}

                  {system.syncMethod === "git" && (
                    <label className="settings-row settings-row-stack">
                      <span className="settings-row-label">
                        Git Commit Message
                      </span>
                      <input
                        className="settings-text-input"
                        value={system.gitCommitMessage}
                        disabled={busy || syncOff}
                        onChange={(e) =>
                          setSystem((s) => ({
                            ...s,
                            gitCommitMessage: e.target.value,
                          }))
                        }
                        onBlur={(e) => {
                          const value = e.target.value.trim();
                          if (value === system.gitCommitMessage.trim()) return;
                          patchSystem({
                            gitCommitMessage:
                              value || DEFAULT_SYSTEM_SETTINGS.gitCommitMessage,
                          });
                        }}
                        placeholder="chore: sync Abyss Gazer data"
                      />
                    </label>
                  )}
                </div>
              </div>
            )}

            {section === "about" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>{t("settings.about")}</h3>
                  <p>{t("settings.aboutHint")}</p>
                  <p className="about-current">
                    {t("settings.currentVersion", { version: `v${APP_VERSION}` })}
                  </p>
                </header>
                <h4 className="about-history-title">{t("settings.releaseHistory")}</h4>
                <ol className="about-releases">
                  {RELEASE_NOTES.map((note) => (
                    <li
                      key={note.version}
                      className={
                        note.version === `v${APP_VERSION}` ? "is-current" : undefined
                      }
                    >
                      <h5>
                        <span>{note.version}</span>
                        {note.date && (
                          <span className="about-release-date">
                            {t("settings.committedOn", { date: note.date })}
                          </span>
                        )}
                      </h5>
                      {note.summary && <p>{note.summary}</p>}
                      {note.items.length > 0 && (
                        <ul>
                          {note.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {error && <p className="error-banner">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
