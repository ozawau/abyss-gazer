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
  onToggleSidebar: () => void;
  collapsed?: boolean;
  pomodoroTick?: PomodoroTick | null;
}

function NavIcon({ id }: { id: ViewId }) {
  const props = {
    className: "nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true as const,
  };
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "checkin":
      return (
        <svg {...props}>
          <path
            d="M4 19V5C4 3.89543 4.89543 3 6 3H19.4C19.7314 3 20 3.26863 20 3.6V16.7143"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <path
            d="M16 8.77975C16 9.38118 15.7625 9.95883 15.3383 10.3861C14.3619 11.3701 13.415 12.3961 12.4021 13.3443C12.17 13.5585 11.8017 13.5507 11.5795 13.3268L8.6615 10.3861C7.7795 9.49725 7.7795 8.06225 8.6615 7.17339C9.55218 6.27579 11.0032 6.27579 11.8938 7.17339L11.9999 7.28027L12.1059 7.17345C12.533 6.74286 13.1146 6.5 13.7221 6.5C14.3297 6.5 14.9113 6.74284 15.3383 7.17339C15.7625 7.60073 16 8.17835 16 8.77975Z"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          <path d="M6 17L20 17" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          <path d="M6 21L20 21" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
          <path
            d="M6 21C4.89543 21 4 20.1046 4 19C4 17.8954 4.89543 17 6 17"
            {...stroke}
          />
        </svg>
      );
    case "tasks":
      return (
        <svg {...props}>
          <path d="M9 6L20 6" {...stroke} />
          <path d="M3.80002 5.79999L4.60002 6.59998L6.60001 4.59999" {...stroke} />
          <path d="M3.80002 11.8L4.60002 12.6L6.60001 10.6" {...stroke} />
          <path d="M3.80002 17.8L4.60002 18.6L6.60001 16.6" {...stroke} />
          <path d="M9 12L20 12" {...stroke} />
          <path d="M9 18L20 18" {...stroke} />
        </svg>
      );
    case "pomodoro":
      return (
        <svg {...props}>
          <path d="M17 13H12V8" {...stroke} />
          <path d="M5 3.5L7 2" {...stroke} />
          <path d="M19 3.5L17 2" {...stroke} />
          <path
            d="M12 22C16.9706 22 21 17.9706 21 13C21 8.02944 16.9706 4 12 4C7.02944 4 3 8.02944 3 13C3 17.9706 7.02944 22 12 22Z"
            {...stroke}
          />
        </svg>
      );
    case "calendar":
      return (
        <svg {...props}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2" {...stroke} />
          <path d="M3.5 10h17" {...stroke} />
          <path d="M8 3.5v3M16 3.5v3" {...stroke} />
        </svg>
      );
    case "gantt":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="10" height="3.2" rx="1" {...stroke} />
          <rect x="3" y="10.4" width="16" height="3.2" rx="1" {...stroke} />
          <rect x="3" y="15.8" width="7" height="3.2" rx="1" {...stroke} />
        </svg>
      );
  }
}

export function SidebarToggleButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const label = collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar");
  return (
    <button
      type="button"
      className={`sidebar-toggle${collapsed ? " is-collapsed" : ""}`}
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect
          x="1.2"
          y="2.2"
          width="13.6"
          height="11.6"
          rx="1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path d="M6 2.6v10.8" stroke="currentColor" strokeWidth="1.4" />
        <path
          d={collapsed ? "M8.6 6.1 11 8 8.6 9.9" : "M10.8 6.1 8.4 8 10.8 9.9"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export function Sidebar({
  items,
  activeView,
  onNavigate,
  selectedTaskTitle,
  subNavOpen,
  onToggleSubNav,
  onOpenSettings,
  onToggleSidebar,
  collapsed = false,
  pomodoroTick = null,
}: SidebarProps) {
  const { t } = useI18n();
  if (collapsed) {
    return (
      <aside className="sidebar is-collapsed">
        <SidebarToggleButton collapsed onClick={onToggleSidebar} />
        <nav className="nav" aria-label={t("nav.main")}>
          {items.map((item) => {
            const label = t(NAV_LABEL[item.id]);
            const timing =
              item.id === "pomodoro" && isPomodoroTiming(pomodoroTick) && pomodoroTick;
            const title = timing
              ? `${label} ${formatPomodoroClock(pomodoroTick.remaining)}`
              : item.enabled
                ? label
                : t("nav.comingSoon", { label });
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-icon-btn${activeView === item.id ? " is-active" : ""}${
                  !item.enabled ? " is-disabled" : ""
                }`}
                disabled={!item.enabled}
                aria-label={title}
                title={title}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => item.enabled && onNavigate(item.id)}
              >
                <NavIcon id={item.id} />
              </button>
            );
          })}
        </nav>
      </aside>
    );
  }
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <div className="brand-text">
          <span className="brand-name">Abyss Gazer</span>
          <span className="brand-tag">Focus & Tasks</span>
        </div>
        <SidebarToggleButton collapsed={false} onClick={onToggleSidebar} />
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
                <span className="nav-item-lead">
                  <NavIcon id={item.id} />
                  <span className="nav-label">{label}</span>
                </span>
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
