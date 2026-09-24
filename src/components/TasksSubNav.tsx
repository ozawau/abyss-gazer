import { useI18n } from "./LocaleProvider";
import type { MessageKey } from "../lib/i18n";
import { TASKS_SUB_NAV, type TasksSubPage } from "../lib/tasksNav";

const PAGE_LABEL: Record<TasksSubPage, MessageKey> = {
  active: "nav.current",
  upcoming: "nav.upcoming",
  completed: "nav.completed",
};

interface TasksSubNavProps {
  activePage: TasksSubPage;
  onNavigate: (page: TasksSubPage) => void;
}

export function TasksSubNav({ activePage, onNavigate }: TasksSubNavProps) {
  const { t } = useI18n();
  return (
    <aside className="tasks-subnav" aria-label={t("nav.subPages")}>
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
            {t(PAGE_LABEL[item.id])}
          </button>
        ))}
      </nav>
    </aside>
  );
}
