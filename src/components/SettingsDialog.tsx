import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import {
  DEFAULT_POMODORO_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  getActiveDataDir,
  getDbPath,
  getDefaultDataDir,
  getPomodoroSettings,
  getSystemSettings,
  PomodoroSettings,
  setDataDirectory,
  setPomodoroSettings,
  setSystemSettings,
  SyncIntervalMinutes,
  SyncMethod,
  SystemSettings,
  WeekStartsOn,
} from "../lib/api";
import {
  SILENT_SOUND,
  forgetCachedSound,
  isSilentSound,
  playPomodoroEndChime,
} from "../lib/pomodoroChime";
import { ToggleSwitch } from "./ToggleSwitch";

type SettingsSection = "pomodoro" | "calendar" | "system";

const WEEK_START_OPTIONS: { value: WeekStartsOn; label: string }[] = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onPomodoroSettingsChange: (settings: PomodoroSettings) => void;
  onSystemSettingsChange: (settings: SystemSettings) => void;
  onDataPathChange: (dbPath: string) => void;
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
  const [activeDataDir, setActiveDataDir] = useState("");
  const [defaultDataDir, setDefaultDataDir] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    Promise.all([
      getPomodoroSettings(),
      getSystemSettings(),
      getActiveDataDir(),
      getDefaultDataDir(),
    ])
      .then(([pomodoro, systemSettings, activeDir, defaultDir]) => {
        if (cancelled) return;
        setSettings({ ...DEFAULT_POMODORO_SETTINGS, ...pomodoro });
        setSystem(systemSettings);
        setActiveDataDir(activeDir);
        setDefaultDataDir(defaultDir);
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
    void persistSystem(next);
  }

  function commitNumber(
    key: keyof PomodoroSettings,
    raw: string,
    clamp: (n: number) => number,
  ) {
    const parsed = Number(raw);
    const value = clamp(parsed);
    if (settings[key] === value) return;
    patchPomodoro({ [key]: value } as Partial<PomodoroSettings>);
  }

  async function chooseDataDir() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择数据文件目录",
        defaultPath: activeDataDir || defaultDataDir || undefined,
      });
      if (selected == null || Array.isArray(selected)) return;
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
    if (!path) return "默认提示音";
    if (isSilentSound(path)) return "无提示音";
    const name = path.split(/[/\\]/).pop();
    return name || path;
  }

  async function chooseSound(key: "focusEndSound" | "breakEndSound") {
    try {
      const selected = await openDialog({
        multiple: false,
        title: "选择提示音",
        filters: [{ name: "音频", extensions: ["mp3", "wav"] }],
      });
      if (selected == null || Array.isArray(selected)) return;
      forgetCachedSound(settings[key]);
      patchPomodoro({ [key]: selected } as Partial<PomodoroSettings>);
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

  async function chooseBackupDir() {
    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "选择本地备份目录",
        defaultPath: system.localBackupDir || undefined,
      });
      if (selected == null || Array.isArray(selected)) return;
      patchSystem({ localBackupDir: selected });
    } catch (err) {
      setError(String(err));
    }
  }

  const breaksOff = !settings.breaksEnabled;
  const longBreakOff = breaksOff || !settings.longBreakEnabled;
  const syncOff = !system.syncEnabled;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-dialog-header">
          <h2 id="settings-dialog-title">设置</h2>
          <button
            type="button"
            className="ghost-btn"
            onClick={onClose}
            disabled={busy}
          >
            关闭
          </button>
        </div>

        <div className="settings-dialog-body">
          <nav className="settings-dialog-nav" aria-label="设置分类">
            <button
              type="button"
              className={`settings-nav-item${
                section === "pomodoro" ? " is-active" : ""
              }`}
              onClick={() => setSection("pomodoro")}
            >
              番茄钟
            </button>
            <button
              type="button"
              className={`settings-nav-item${
                section === "calendar" ? " is-active" : ""
              }`}
              onClick={() => setSection("calendar")}
            >
              日历
            </button>
            <button
              type="button"
              className={`settings-nav-item${
                section === "system" ? " is-active" : ""
              }`}
              onClick={() => setSection("system")}
            >
              系统设置
            </button>
          </nav>

          <div className="settings-dialog-content">
            {section === "pomodoro" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>番茄钟</h3>
                  <p>调整专注与休息节奏，立即作用于番茄钟页面。</p>
                </header>

                <label className="settings-row">
                  <span className="settings-row-label">单个番茄时间</span>
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
                    <span>分钟</span>
                  </span>
                </label>

                <div className="settings-row">
                  <span className="settings-row-label">是否休息</span>
                  <ToggleSwitch
                    label="是否休息"
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
                    <span className="settings-row-label">短休息时间</span>
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
                      <span>分钟</span>
                    </span>
                  </label>

                  <div className="settings-row">
                    <span className="settings-row-label">是否开启长休息</span>
                    <ToggleSwitch
                      label="是否开启长休息"
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
                      <span className="settings-row-label">长休息时间</span>
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
                        <span>分钟</span>
                      </span>
                    </label>

                    <label className="settings-row">
                      <span className="settings-row-label">长休息间隔</span>
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
                        <span>个番茄</span>
                      </span>
                    </label>
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-row-label">
                    是否自动进入下一个番茄
                  </span>
                  <ToggleSwitch
                    label="是否自动进入下一个番茄"
                    checked={settings.autoStartFocus}
                    disabled={busy}
                    onChange={(checked) =>
                      patchPomodoro({ autoStartFocus: checked })
                    }
                  />
                </div>

                <div className="settings-row">
                  <span className="settings-row-label">
                    是否自动进入下一个休息
                  </span>
                  <ToggleSwitch
                    label="是否自动进入下一个休息"
                    checked={settings.autoStartBreak}
                    disabled={busy || breaksOff}
                    onChange={(checked) =>
                      patchPomodoro({ autoStartBreak: checked })
                    }
                  />
                </div>

                <div className="settings-row settings-row-stack">
                  <span className="settings-row-label">专注结束提示音</span>
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
                      试听
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => void chooseSound("focusEndSound")}
                    >
                      选择
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || settings.focusEndSound == null}
                      onClick={() => resetSound("focusEndSound")}
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || isSilentSound(settings.focusEndSound)}
                      onClick={() => muteSound("focusEndSound")}
                    >
                      无
                    </button>
                  </div>
                </div>

                <div className="settings-row settings-row-stack">
                  <span className="settings-row-label">休息结束提示音</span>
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
                      试听
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy}
                      onClick={() => void chooseSound("breakEndSound")}
                    >
                      选择
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || settings.breakEndSound == null}
                      onClick={() => resetSound("breakEndSound")}
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={busy || isSilentSound(settings.breakEndSound)}
                      onClick={() => muteSound("breakEndSound")}
                    >
                      无
                    </button>
                  </div>
                </div>
              </div>
            )}

            {section === "calendar" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>日历</h3>
                  <p>调整年、月、周视图的展示方式。</p>
                </header>

                <label className="settings-row">
                  <span className="settings-row-label">一周开始于</span>
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
                    {WEEK_START_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            {section === "system" && (
              <div className="settings-panel">
                <header className="settings-panel-header">
                  <h3>系统设置</h3>
                  <p>管理开机启动、数据目录与同步备份。</p>
                </header>

                <div className="settings-row">
                  <span className="settings-row-label">开机启动</span>
                  <ToggleSwitch
                    label="开机启动"
                    checked={system.launchAtLogin}
                    disabled={busy}
                    onChange={(checked) =>
                      patchSystem({ launchAtLogin: checked })
                    }
                  />
                </div>

                <div className="settings-row settings-row-stack">
                  <span className="settings-row-label">数据文件目录</span>
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
                      选择目录
                    </button>
                  </div>
                </div>

                <div className="settings-row">
                  <span className="settings-row-label">开启同步</span>
                  <ToggleSwitch
                    label="开启同步"
                    checked={system.syncEnabled}
                    disabled={busy}
                    onChange={(checked) =>
                      patchSystem({ syncEnabled: checked })
                    }
                  />
                </div>

                <div
                  className={`settings-group${syncOff ? " is-disabled" : ""}`}
                >
                  <label className="settings-row">
                    <span className="settings-row-label">同步方式</span>
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
                      <option value="local">本地磁盘</option>
                      <option value="git">Git</option>
                    </select>
                  </label>

                  <label className="settings-row">
                    <span className="settings-row-label">同步间隔</span>
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
                      <option value={5}>5 分钟</option>
                      <option value={10}>10 分钟</option>
                      <option value={30}>30 分钟</option>
                    </select>
                  </label>

                  {system.syncMethod === "local" && (
                    <div className="settings-row settings-row-stack">
                      <span className="settings-row-label">备份目录</span>
                      <div className="settings-path-block">
                        <code className="settings-path-value">
                          {system.localBackupDir || "未选择"}
                        </code>
                        <button
                          type="button"
                          className="secondary-btn"
                          disabled={busy || syncOff}
                          onClick={() => void chooseBackupDir()}
                        >
                          选择目录
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

            {error && <p className="error-banner">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
