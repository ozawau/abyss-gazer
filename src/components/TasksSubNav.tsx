import { TASKS_SUB_NAV, type TasksSubPage } from "../lib/tasksNav";

interface TasksSubNavProps {
  activePage: TasksSubPage;
  onNavigate: (page: TasksSubPage) => void;
}

export function TasksSubNav({ activePage, onNavigate }: TasksSubNavProps) {
  return (
    <aside className="tasks-subnav" aria-label="任务子页面">
      <nav className="tasks-subnav-list">
        {TASKS_SUB_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tasks-subnav-item${
              activePage === item.id ? " is-active" : ""
            }`}
            onClick={() => onNavigate(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
