import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LocaleProvider, publishSystemSettings, useI18n } from "./components/LocaleProvider";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar } from "./components/Sidebar";
import { TasksSubNav } from "./components/TasksSubNav";
import {
  DEFAULT_POMODORO_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  getPomodoroSettings,
  getSystemSettings,
  listTasks,
  PomodoroSettings,
  reopenDatabase,
  runDataSync,
  setSystemSettings as persistSystemSettings,
  SystemSettings,
  Task,
} from "./lib/api";
import { initCnHolidayData } from "./lib/cnHolidayData";
import { type GanttActivityMode } from "./lib/gantt";
import { syncPomodoroPresence } from "./lib/pomodoroPresence";
import { type PomodoroTick } from "./lib/pomodoroTimer";
import { NAV_ITEMS, ViewId } from "./lib/nav";
import { ANDROID_BACK_EVENT, dismissTopAndroidPopup, useDismissOnAndroidBack } from "./lib/androidBack";
import { isAndroidDevice, useNarrowViewport } from "./lib/viewport";
import { formatTaskLineage, taskById } from "./lib/taskTree";
import type { TasksSubPage } from "./lib/tasksNav";
import { CompletedTasksView } from "./views/CompletedTasksView";
import { CalendarView } from "./views/CalendarView";
import { CheckinView } from "./views/CheckinView";
import { GanttView } from "./views/GanttView";
import { PomodoroView } from "./views/PomodoroView";
import { CategoryFilter, TasksView } from "./views/TasksView";
import { UpcomingTasksView } from "./views/UpcomingTasksView";
import { TrayCalendar } from "./views/TrayCalendar";
import "./styles/app.css";

function isTrayCalendarWindow(): boolean {
  if (new URLSearchParams(window.location.search).get("view") === "tray-calendar") {
    return true;
  }
  try {
    return getCurrentWindow().label === "tray-calendar";
  } catch {
    return false;
  }
}

function ViewSlot({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={active ? "view-slot" : "view-slot is-hidden"}
      aria-hidden={!active}
      inert={!active}
    >
      {children}
    </div>
  );
}

function MainApp() {
  const { locale, t } = useI18n();

  useLayoutEffect(() => {
    try {
      void getCurrentWindow().show();
    } catch {
      /* Outside the Tauri webview there is no window to show. */
    }
  }, []);
  const [activeView, setActiveView] = useState<ViewId>("checkin");
  useEffect(() => {
    const openCheckin = () => setActiveView("checkin");
    const win = window as Window & {
      __abyssCheckinReady?: boolean;
      __abyssPendingCheckin?: boolean;
    };
    window.addEventListener("abyss-open-checkin", openCheckin);
    if (win.__abyssPendingCheckin) {
      win.__abyssPendingCheckin = false;
      openCheckin();
    }
    win.__abyssCheckinReady = true;
    return () => {
      win.__abyssCheckinReady = false;
      window.removeEventListener("abyss-open-checkin", openCheckin);
    };
  }, []);
  const [tasksSubPage, setTasksSubPage] = useState<TasksSubPage>("active");
  const [mountedViews, setMountedViews] = useState<ReadonlySet<ViewId>>(
    () => new Set<ViewId>(["checkin"]),
  );
  const [mountedTaskPages, setMountedTaskPages] = useState<
    ReadonlySet<TasksSubPage>
  >(() => new Set<TasksSubPage>());
  const [subNavOpen, setSubNavOpen] = useState<Partial<Record<ViewId, boolean>>>(
    {},
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pomodoroTaskId, setPomodoroTaskId] = useState<string | null>(null);
  const [pomodoroTiming, setPomodoroTiming] = useState(false);
  const [pomodoroTick, setPomodoroTick] = useState<PomodoroTick | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pomodoroPlayToken, setPomodoroPlayToken] = useState(0);
  const [pomodoroFullscreen, setPomodoroFullscreen] = useState(false);
  const pomodoroFullscreenRef = useRef(pomodoroFullscreen);
  pomodoroFullscreenRef.current = pomodoroFullscreen;
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const [tasksCategoryFilter, setTasksCategoryFilter] =
    useState<CategoryFilter>("all");
  const [upcomingCategoryFilter, setUpcomingCategoryFilter] =
    useState<CategoryFilter>("all");
  const [completedCategoryFilter, setCompletedCategoryFilter] =
    useState<CategoryFilter>("all");
  const [ganttCategoryFilter, setGanttCategoryFilter] =
    useState<CategoryFilter>("all");
  const [calendarCategoryFilter, setCalendarCategoryFilter] =
    useState<CategoryFilter>("all");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const syncErrorRef = useRef<HTMLDivElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const systemReady = useRef(false);
  const [pomodoroSettings, setPomodoroSettings] = useState<PomodoroSettings>(
    DEFAULT_POMODORO_SETTINGS,
  );
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(
    DEFAULT_SYSTEM_SETTINGS,
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  useDismissOnAndroidBack(syncError != null, () => setSyncError(null), syncErrorRef);
  const [dataEpoch, setDataEpoch] = useState(0);
  useEffect(() => {
    const refresh = () => setDataEpoch((n) => n + 1);
    window.addEventListener("abyss-checkin-changed", refresh);
    return () => window.removeEventListener("abyss-checkin-changed", refresh);
  }, []);
  const tasksLoadGen = useRef(0);

  useEffect(() => {
    initCnHolidayData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const gen = tasksLoadGen.current;
    listTasks()
      .then((rows) => {
        if (!cancelled && tasksLoadGen.current === gen) setTasks(rows);
      })
      .catch((err) => {
        if (!cancelled && tasksLoadGen.current === gen) setLoadError(String(err));
      });
    getPomodoroSettings()
      .then((settings) => {
        if (!cancelled) {
          setPomodoroSettings({ ...DEFAULT_POMODORO_SETTINGS, ...settings });
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    getSystemSettings()
      .then((settings) => {
        if (!cancelled) {
          systemReady.current = true;
          const merged = { ...DEFAULT_SYSTEM_SETTINGS, ...settings };
          setSystemSettings(merged);
          publishSystemSettings(merged);
          setSidebarOpen(!settings.sidebarCollapsed);
        }
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAndroidDevice()) return;
    let cancelled = false;
    const onForeground = () => {
      const gen = ++tasksLoadGen.current;
      void (async () => {
        try {
          await reopenDatabase();
          if (cancelled || tasksLoadGen.current !== gen) return;
          const [rows, pomodoro] = await Promise.all([
            listTasks(),
            getPomodoroSettings(),
          ]);
          if (cancelled || tasksLoadGen.current !== gen) return;
          setTasks(rows);
          setPomodoroSettings({ ...DEFAULT_POMODORO_SETTINGS, ...pomodoro });
          setDataEpoch((n) => n + 1);
          setLoadError(null);
        } catch (err) {
          if (!cancelled && tasksLoadGen.current === gen) setLoadError(String(err));
        }
      })();
    };
    window.addEventListener("abyss-foreground", onForeground);
    return () => {
      cancelled = true;
      window.removeEventListener("abyss-foreground", onForeground);
    };
  }, []);

  useEffect(() => {
    if (!systemSettings.syncEnabled) return;

    let cancelled = false;
    let inFlight = false;

    async function tick() {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await runDataSync();
      } catch (err) {
        if (!cancelled) {
          setSystemSettings((prev) => ({ ...prev, syncEnabled: false }));
          setSyncError(String(err));
        }
        inFlight = false;
        return;
      }
      if (cancelled) {
        inFlight = false;
        return;
      }
      const gen = ++tasksLoadGen.current;
      try {
        const rows = await listTasks();
        if (cancelled || tasksLoadGen.current !== gen) return;
        setTasks(rows);
        setDataEpoch((n) => n + 1);
        try {
          const pomodoro = await getPomodoroSettings();
          if (!cancelled && tasksLoadGen.current === gen) {
            setPomodoroSettings({ ...DEFAULT_POMODORO_SETTINGS, ...pomodoro });
          }
        } catch {
          /* keep the timings already on screen */
        }
      } catch (err) {
        if (!cancelled && tasksLoadGen.current === gen) setLoadError(String(err));
      } finally {
        inFlight = false;
      }
    }

    void tick();
    const ms = systemSettings.syncIntervalMinutes * 60_000;
    const id = window.setInterval(() => void tick(), ms);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [
    systemSettings.syncEnabled,
    systemSettings.syncMethod,
    systemSettings.syncIntervalMinutes,
    systemSettings.localBackupDir,
    systemSettings.gitCommitMessage,
    systemSettings.dataDir,
  ]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const pomodoroTask = useMemo(
    () => tasks.find((t) => t.id === pomodoroTaskId) ?? null,
    [tasks, pomodoroTaskId],
  );
  const tasksById = useMemo(() => taskById(tasks), [tasks]);
  const currentTaskTitle = useMemo(() => {
    const task = pomodoroTask ?? selectedTask;
    return task ? formatTaskLineage(task, tasksById) : null;
  }, [pomodoroTask, selectedTask, tasksById]);

  const narrow = useNarrowViewport();
  const showTasksSubNav =
    activeView === "tasks" && (narrow || !!subNavOpen.tasks);
  const sidebarCollapsed = !narrow && !sidebarOpen;

  const handlePomodoroTick = useCallback((tick: PomodoroTick) => {
    setPomodoroTick(tick);
    setPomodoroTiming(tick.status !== "idle");
  }, []);

  useEffect(() => {
    void syncPomodoroPresence(pomodoroTick, locale);
  }, [pomodoroTick, locale]);

  useEffect(() => {
    return () => {
      void syncPomodoroPresence(null, locale);
    };
  }, [locale]);

  function handleSelectTask(id: string | null) {
    setSelectedTaskId(id);
    const boundStillExists =
      pomodoroTaskId != null && tasks.some((t) => t.id === pomodoroTaskId);
    if (!pomodoroTiming || !boundStillExists) {
      setPomodoroTaskId(id);
    }
  }

  function rememberView(id: ViewId) {
    setMountedViews((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }

  function rememberTaskPage(page: TasksSubPage) {
    setMountedTaskPages((prev) =>
      prev.has(page) ? prev : new Set(prev).add(page),
    );
  }

  function startPomodoroForTask(taskId: string) {
    setSelectedTaskId(taskId);
    setPomodoroTaskId(taskId);
    setActiveView("pomodoro");
    setPomodoroPlayToken((n) => n + 1);
  }

  function handleNavigate(id: ViewId) {
    setActiveView(id);
    rememberView(id);
    if (id === "tasks") {
      setTasksSubPage("active");
      rememberTaskPage("active");
    }
    if (id !== "pomodoro") setPomodoroFullscreen(false);
  }

  function handleTasksSubPage(page: TasksSubPage) {
    setTasksSubPage(page);
    rememberTaskPage(page);
  }

  function handleToggleSubNav(id: ViewId) {
    const willOpen = !subNavOpen[id];
    setSubNavOpen((prev) => ({ ...prev, [id]: willOpen }));
    if (willOpen && activeView !== id) {
      handleNavigate(id);
    }
  }

  function handleSystemSettingsChange(next: SystemSettings) {
    setSystemSettings(next);
    publishSystemSettings(next);
  }

  function handleGanttActivityModeChange(mode: GanttActivityMode) {
    const next = { ...systemSettings, ganttActivityMode: mode };
    setSystemSettings(next);
    void persistSystemSettings(next).then(setSystemSettings).catch((err) => {
      setLoadError(String(err));
    });
  }

  async function handleDataPathChange(_nextDbPath: string) {
    try {
      const rows = await listTasks();
      setTasks(rows);
    } catch (err) {
      setLoadError(String(err));
    }
  }

  function handleToggleSidebar() {
    const nextOpen = !sidebarOpen;
    setSidebarOpen(nextOpen);
    if (!systemReady.current) return;
    setSystemSettings((prev) => {
      const next = { ...prev, sidebarCollapsed: !nextOpen };
      void persistSystemSettings(next).catch((err) => {
        setLoadError(String(err));
      });
      return next;
    });
  }

  useEffect(() => {
    if (!isAndroidDevice()) return;
    let lastBackAt = 0;
    let toastTimer = 0;
    const toast = document.createElement("div");
    toast.className = "android-exit-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);

    function onBack(event: Event) {
      if (activeViewRef.current !== "pomodoro" || !pomodoroFullscreenRef.current) {
        return;
      }
      event.preventDefault();
      setPomodoroFullscreen(false);
    }

    window.__abyssHandleBack = () => {
      if (dismissTopAndroidPopup()) return "handled";
      const backEvent = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
      if (!window.dispatchEvent(backEvent)) return "handled";
      const now = Date.now();
      if (now - lastBackAt < 2000) return "exit";
      lastBackAt = now;
      toast.textContent = t("common.pressAgainToExit");
      toast.classList.add("is-visible");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toast.classList.remove("is-visible");
      }, 2000);
      return "handled";
    };
    window.addEventListener(ANDROID_BACK_EVENT, onBack);
    return () => {
      window.removeEventListener(ANDROID_BACK_EVENT, onBack);
      delete window.__abyssHandleBack;
      window.clearTimeout(toastTimer);
      toast.remove();
    };
  }, [t]);

  const immersivePomodoro =
    activeView === "pomodoro" && pomodoroFullscreen;

  return (
    <div
      className={`shell${showTasksSubNav ? "" : " no-subnav"}${
        sidebarCollapsed ? " sidebar-collapsed" : ""
      }${immersivePomodoro ? " is-pomodoro-fullscreen" : ""}`}
    >
      {!immersivePomodoro && (
        <Sidebar
          items={NAV_ITEMS}
          activeView={activeView}
          onNavigate={handleNavigate}
          selectedTaskTitle={currentTaskTitle}
          subNavOpen={subNavOpen}
          onToggleSubNav={handleToggleSubNav}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleSidebar={handleToggleSidebar}
          collapsed={sidebarCollapsed}
          pomodoroTick={pomodoroTick}
        />
      )}
      {showTasksSubNav && !immersivePomodoro && (
        <TasksSubNav
          activePage={tasksSubPage}
          onNavigate={handleTasksSubPage}
        />
      )}
      <main className={`main${immersivePomodoro ? " is-immersive" : ""}`}>
        {loadError && <p className="error-banner">{loadError}</p>}
        {mountedTaskPages.has("active") && (
          <ViewSlot active={activeView === "tasks" && tasksSubPage === "active"}>
            <TasksView
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onTasksChange={setTasks}
              onStartPomodoro={startPomodoroForTask}
              categoryFilter={tasksCategoryFilter}
              onCategoryFilterChange={setTasksCategoryFilter}
              dataEpoch={dataEpoch}
            />
          </ViewSlot>
        )}
        {mountedTaskPages.has("upcoming") && (
          <ViewSlot
            active={activeView === "tasks" && tasksSubPage === "upcoming"}
          >
            <UpcomingTasksView
              tasks={tasks}
              onTasksChange={setTasks}
              categoryFilter={upcomingCategoryFilter}
              onCategoryFilterChange={setUpcomingCategoryFilter}
              dataEpoch={dataEpoch}
            />
          </ViewSlot>
        )}
        {mountedTaskPages.has("completed") && (
          <ViewSlot
            active={activeView === "tasks" && tasksSubPage === "completed"}
          >
            <CompletedTasksView
              tasks={tasks}
              onTasksChange={setTasks}
              categoryFilter={completedCategoryFilter}
              onCategoryFilterChange={setCompletedCategoryFilter}
              dataEpoch={dataEpoch}
            />
          </ViewSlot>
        )}
        {mountedViews.has("gantt") && (
          <ViewSlot active={activeView === "gantt"}>
            <GanttView
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onStartPomodoro={startPomodoroForTask}
              weekStartsOn={systemSettings.weekStartsOn}
              activityMode={systemSettings.ganttActivityMode}
              onActivityModeChange={handleGanttActivityModeChange}
              categoryFilter={ganttCategoryFilter}
              onCategoryFilterChange={setGanttCategoryFilter}
              dataEpoch={dataEpoch}
            />
          </ViewSlot>
        )}
        {mountedViews.has("calendar") && (
          <ViewSlot active={activeView === "calendar"}>
            <CalendarView
              tasks={tasks}
              selectedTaskId={selectedTaskId}
              onSelectTask={handleSelectTask}
              onStartPomodoro={startPomodoroForTask}
              weekStartsOn={systemSettings.weekStartsOn}
              categoryFilter={calendarCategoryFilter}
              onCategoryFilterChange={setCalendarCategoryFilter}
              dataEpoch={dataEpoch}
            />
          </ViewSlot>
        )}
        {mountedViews.has("checkin") && (
          <ViewSlot active={activeView === "checkin"}>
            <CheckinView
              tasks={tasks}
              systemSettings={systemSettings}
              weekStartsOn={systemSettings.weekStartsOn}
              dataEpoch={dataEpoch}
            />
          </ViewSlot>
        )}
        <div
          className={
            activeView === "pomodoro" ? "view-slot" : "view-slot is-hidden"
          }
          aria-hidden={activeView !== "pomodoro"}
          inert={activeView !== "pomodoro"}
        >
          <PomodoroView
            tasks={tasks}
            selectedTask={pomodoroTask}
            settings={pomodoroSettings}
            playToken={pomodoroPlayToken}
            fullscreen={pomodoroFullscreen}
            onToggleFullscreen={() =>
              setPomodoroFullscreen((v) => !v)
            }
            onTimingChange={setPomodoroTiming}
            onTick={handlePomodoroTick}
            onTaskChange={(task) => {
              setTasks((prev) =>
                prev.map((row) => (row.id === task.id ? task : row)),
              );
            }}
            dataEpoch={dataEpoch}
            onSessionsChanged={() => {
              const gen = ++tasksLoadGen.current;
              void listTasks()
                .then((rows) => {
                  if (tasksLoadGen.current === gen) setTasks(rows);
                })
                .catch((err) => {
                  if (tasksLoadGen.current === gen) setLoadError(String(err));
                });
            }}
          />
        </div>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onPomodoroSettingsChange={setPomodoroSettings}
        onSystemSettingsChange={handleSystemSettingsChange}
        onDataPathChange={(path) => void handleDataPathChange(path)}
      />

      {syncError && (
        <div
          ref={syncErrorRef}
          className="modal-backdrop"
          role="presentation"
          onClick={() => setSyncError(null)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-error-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="sync-error-title">{t("syncStopped")}</h2>
            <div className="delete-confirm">
              <p>{syncError}</p>
              <div className="delete-confirm-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setSyncError(null)}
                >
                  {t("common.ok")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      {isTrayCalendarWindow() ? <TrayCalendar /> : <MainApp />}
    </LocaleProvider>
  );
}
