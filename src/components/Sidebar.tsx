import { useI18n } from "./LocaleProvider";
import type { MessageKey } from "../lib/i18n";
import type { NavItem, ViewId } from "../lib/nav";

const NAV_LABEL: Record<ViewId, MessageKey> = {
  checkin: "nav.checkin",
  tasks: "nav.tasks",
  pomodoro: "nav.pomodoro",
  calendar: "nav.calendar",
  gantt: "nav.gantt",
};
import {
  formatPomodoroClock,
  isPomodoroTiming,
  pomodoroTimeMark,
  type PomodoroTick,
} from "../lib/pomodoroTimer";

interface SidebarProps {
  items: NavItem[];
  activeView: ViewId;
  onNavigate: (id: ViewId) => void;
  selectedTaskTitle: string | null;
  /** Which views currently have their sub-nav open. */
  subNavOpen: Partial<Record<ViewId, boolean>>;
  onToggleSubNav: (id: ViewId) => void;
  onOpenSettings: () => void;
  pomodoroTick?: PomodoroTick | null;
}

export function Sidebar({
  items,
  activeView,
  onNavigate,
  selectedTaskTitle,
  subNavOpen,
  onToggleSubNav,
  onOpenSettings,
  pomodoroTick = null,
}: SidebarProps) {
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <div className="brand-text">
          <span className="brand-name">Abyss Gazer</span>
          <span className="brand-tag">Focus & Tasks</span>
        </div>
      </div>

      <nav className="nav" aria-label={t("nav.main")}>
        {items.map((item) => {
          const open = !!subNavOpen[item.id];
          const label = t(NAV_LABEL[item.id]);
          return (
            <div
              key={item.id}
              className={`nav-row${activeView === item.id ? " is-active" : ""}${
                !item.enabled ? " is-disabled" : ""
              }`}
            >
              <button
                type="button"
                className="nav-item"
                disabled={!item.enabled}
                onClick={() => item.enabled && onNavigate(item.id)}
                title={item.enabled ? label : t("nav.comingSoon", { label })}
              >
                <span className="nav-label">{label}</span>
                {item.id === "pomodoro" && isPomodoroTiming(pomodoroTick) && pomodoroTick && (
                  <span
                    className={`nav-timer is-${pomodoroTick.phase}${
                      pomodoroTick.status === "paused" ? " is-paused" : ""
                    }`}
                  >
                    <span className="nav-timer-mark" aria-hidden>
                      {pomodoroTimeMark(
                        pomodoroTick.phase,
                        pomodoroTick.status === "paused",
                      )}
                    </span>
                    <span className="nav-timer-clock">
                      {formatPomodoroClock(pomodoroTick.remaining)}
                    </span>
                  </span>
                )}
                {!item.enabled && <span className="nav-soon">Soon</span>}
              </button>
              {item.hasSubNav && item.enabled && (
                <button
                  type="button"
                  className={`nav-subnav-toggle${open ? " is-open" : ""}`}
                  aria-label={
                    open
                      ? t("nav.collapseSub", { label })
                      : t("nav.expandSub", { label })
                  }
                  aria-expanded={open}
                  title={open ? t("nav.collapseSubTitle") : t("nav.expandSubTitle")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSubNav(item.id);
                  }}
                >
                  {open ? "‹" : "›"}
                </button>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="selected-task-chip">
          <span className="chip-label">{t("nav.currentTask")}</span>
          <span className="chip-value">
            {selectedTaskTitle ?? t("nav.noneSelected")}
          </span>
        </div>
        <button
          type="button"
          className="sidebar-settings-btn"
          onClick={onOpenSettings}
        >
          {t("common.settings")}
        </button>
      </div>
    </aside>
  );
}
