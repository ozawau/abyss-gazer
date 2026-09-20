import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TasksSubNav } from "./components/TasksSubNav";
import { getDbPath, listTasks, Task } from "./lib/api";
import { NAV_ITEMS, ViewId } from "./lib/nav";
import type { TasksSubPage } from "./lib/tasksNav";
import { CompletedTasksView } from "./views/CompletedTasksView";
import { PomodoroView } from "./views/PomodoroView";
import { CategoryFilter, TasksView } from "./views/TasksView";
import "./styles/app.css";

function App() {
  const [activeView, setActiveView] = useState<ViewId>("tasks");
  const [tasksSubPage, setTasksSubPage] = useState<TasksSubPage>("active");
  const [subNavOpen, setSubNavOpen] = useState<Partial<Record<ViewId, boolean>>>(
    {},
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pomodoroTaskId, setPomodoroTaskId] = useState<string | null>(null);
  const [pomodoroTiming, setPomodoroTiming] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [pomodoroPlayToken, setPomodoroPlayToken] = useState(0);
  const [pomodoroFullscreen, setPomodoroFullscreen] = useState(false);
  const [tasksCategoryFilter, setTasksCategoryFilter] =
    useState<CategoryFilter>("all");

  useEffect(() => {
    let cancelled = false;
    listTasks()
      .then((rows) => {
        if (!cancelled) setTasks(rows);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    getDbPath()
      .then((path) => {
        if (!cancelled) setDbPath(path);
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const pomodoroTask = useMemo(
    () => tasks.find((t) => t.id === pomodoroTaskId) ?? null,
    [tasks, pomodoroTaskId],
  );

  const showTasksSubNav = activeView === "tasks" && !!subNavOpen.tasks;

  function handleSelectTask(id: string | null) {
    setSelectedTaskId(id);
    if (!pomodoroTiming) {
      setPomodoroTaskId(id);
    }
  }

  function startPomodoroForTask(taskId: string) {
    setSelectedTaskId(taskId);
    setPomodoroTaskId(taskId);
    setActiveView("pomodoro");
    setPomodoroPlayToken((n) => n + 1);
  }

  function handleNavigate(id: ViewId) {
    setActiveView(id);
    if (id === "tasks") setTasksSubPage("active");
    if (id !== "pomodoro") setPomodoroFullscreen(false);
  }

  function handleToggleSubNav(id: ViewId) {
    const willOpen = !subNavOpen[id];
    setSubNavOpen((prev) => ({ ...prev, [id]: willOpen }));
    if (willOpen && activeView !== id) {
      handleNavigate(id);
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
          selectedTaskTitle={
            pomodoroTask?.title ?? selectedTask?.title ?? null
          }
          dbPath={dbPath}
          subNavOpen={subNavOpen}
          onToggleSubNav={handleToggleSubNav}
        />
      )}
      {showTasksSubNav && !immersivePomodoro && (
        <TasksSubNav
          activePage={tasksSubPage}
          onNavigate={setTasksSubPage}
        />
      )}
      <main className={`main${immersivePomodoro ? " is-immersive" : ""}`}>
        {loadError && <p className="error-banner">{loadError}</p>}
        {activeView === "tasks" && tasksSubPage === "active" && (
          <TasksView
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={handleSelectTask}
            onTasksChange={setTasks}
            onStartPomodoro={startPomodoroForTask}
            categoryFilter={tasksCategoryFilter}
            onCategoryFilterChange={setTasksCategoryFilter}
          />
        )}
        {activeView === "tasks" && tasksSubPage === "completed" && (
          <CompletedTasksView tasks={tasks} onTasksChange={setTasks} />
        )}
        <div
          className={
            activeView === "pomodoro" ? "view-slot" : "view-slot is-hidden"
          }
          aria-hidden={activeView !== "pomodoro"}
        >
          <PomodoroView
            selectedTask={pomodoroTask}
            playToken={pomodoroPlayToken}
            fullscreen={pomodoroFullscreen}
            onToggleFullscreen={() =>
              setPomodoroFullscreen((v) => !v)
            }
            onTimingChange={setPomodoroTiming}
            onSessionsChanged={() => {
              void listTasks()
                .then(setTasks)
                .catch((err) => setLoadError(String(err)));
            }}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
