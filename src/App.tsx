import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  const [activeView, setActiveView] = useState<ViewId>("checkin");
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
  const [pomodoroSettings, setPomodoroSettings] = useState<PomodoroSettings>(
    DEFAULT_POMODORO_SETTINGS,
  );
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(
    DEFAULT_SYSTEM_SETTINGS,
  );
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    initCnHolidayData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    listTasks()
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
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
        if (!cancelled) setSystemSettings(settings);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
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
        if (cancelled) return;
        setSystemSettings((prev) => ({ ...prev, syncEnabled: false }));
        setSyncError(String(err));
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

  const showTasksSubNav = activeView === "tasks" && !!subNavOpen.tasks;

  const handlePomodoroTick = useCallback((tick: PomodoroTick) => {
    setPomodoroTick(tick);
    setPomodoroTiming(tick.status !== "idle");
  }, []);

  useEffect(() => {
    void syncPomodoroPresence(pomodoroTick);
  }, [pomodoroTick]);

  useEffect(() => {
    return () => {
      void syncPomodoroPresence(null);
    };
  }, []);

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

  const immersivePomodoro =
    activeView === "pomodoro" && pomodoroFullscreen;

  return (
    <div
      className={`shell${showTasksSubNav ? "" : " no-subnav"}${
        immersivePomodoro ? " is-pomodoro-fullscreen" : ""
      }`}
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
            />
          </ViewSlot>
        )}
        {mountedViews.has("checkin") && (
          <ViewSlot active={activeView === "checkin"}>
            <CheckinView
              tasks={tasks}
              weekStartsOn={systemSettings.weekStartsOn}
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
            onSessionsChanged={() => {
              void listTasks()
                .then(setTasks)
                .catch((err) => setLoadError(String(err)));
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
            <h2 id="sync-error-title">同步已停止</h2>
            <div className="delete-confirm">
              <p>{syncError}</p>
              <div className="delete-confirm-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setSyncError(null)}
                >
                  知道了
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
  if (isTrayCalendarWindow()) return <TrayCalendar />;
  return <MainApp />;
}
