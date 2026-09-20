import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { getDbPath, listTasks, Task } from "./lib/api";
import { NAV_ITEMS, ViewId } from "./lib/nav";
import { PomodoroView } from "./views/PomodoroView";
import { TasksView } from "./views/TasksView";
import "./styles/app.css";

function App() {
  const [activeView, setActiveView] = useState<ViewId>("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dbPath, setDbPath] = useState<string | null>(null);

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

  return (
    <div className="shell">
      <Sidebar
        items={NAV_ITEMS}
        activeView={activeView}
        onNavigate={setActiveView}
        selectedTaskTitle={selectedTask?.title ?? null}
        dbPath={dbPath}
      />
      <main className="main">
        {loadError && <p className="error-banner">{loadError}</p>}
        {activeView === "tasks" && (
          <TasksView
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onTasksChange={setTasks}
          />
        )}
        {activeView === "pomodoro" && (
          <PomodoroView selectedTask={selectedTask} />
        )}
      </main>
    </div>
  );
}

export default App;
