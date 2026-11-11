import { useEffect, useState } from "react";
import { APP_VERSION } from "../lib/changelog";
import { requestManualSync, subscribeSyncActivity } from "../lib/dataSync";
import type { MessageKey } from "../lib/i18n";
import type { NavItem, ViewId } from "../lib/nav";
import { useI18n } from "./LocaleProvider";

const NAV_LABEL: Record<ViewId, MessageKey> = {
  checkin: "nav.checkin",
  tasks: "nav.tasks",
  pomodoro: "nav.pomodoro",
  calendar: "nav.calendar",
  gantt: "nav.gantt",
  statistics: "nav.statistics",
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
  onRequestCancelSync: () => void;
  onToggleSidebar: () => void;
  collapsed?: boolean;
  pomodoroTick?: PomodoroTick | null;
}

function SyncIcon({ busy }: { busy: boolean }) {
  const props = {
    className: "nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true as const,
  };
  if (busy) {
    return (
      <svg {...props}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1.25 12C1.25 6.06294 6.06294 1.25 12 1.25C17.9371 1.25 22.75 6.06294 22.75 12C22.75 17.9371 17.9371 22.75 12 22.75C6.06294 22.75 1.25 17.9371 1.25 12ZM11.9877 7.75C9.70121 7.75 7.9471 9.28219 7.74541 11.0835C7.69932 11.4951 7.32825 11.7914 6.91661 11.7453C6.50497 11.6992 6.20863 11.3282 6.25472 10.9165C6.556 8.22597 9.07599 6.25 11.9877 6.25C13.6578 6.25 15.1863 6.8937 16.2503 7.94689V7.5C16.2503 7.08579 16.5861 6.75 17.0003 6.75C17.4145 6.75 17.7503 7.08579 17.7503 7.5V9.12222C17.7503 9.86781 17.1459 10.4722 16.4003 10.4722H14.4941C14.0799 10.4722 13.7441 10.1364 13.7441 9.72222C13.7441 9.30801 14.0799 8.97222 14.4941 8.97222H15.1523C14.3818 8.23175 13.2617 7.75 11.9877 7.75ZM12.0123 16.25C14.158 16.25 16.03 14.4222 16.2529 11.9331C16.2899 11.5205 16.6543 11.216 17.0669 11.253C17.4794 11.2899 17.7839 11.6544 17.747 12.0669C17.467 15.1926 15.0648 17.75 12.0123 17.75C10.3037 17.75 8.79345 16.943 7.74967 15.6877V16.4004C7.74967 16.8146 7.41389 17.1504 6.99967 17.1504C6.58546 17.1504 6.24967 16.8146 6.24967 16.4004V14.2226C6.24967 13.477 6.85409 12.8726 7.59967 12.8726H9.50586C9.92007 12.8726 10.2559 13.2084 10.2559 13.6226C10.2559 14.0368 9.92007 14.3726 9.50586 14.3726H8.63282C9.42384 15.5314 10.6601 16.25 12.0123 16.25Z"
        />
      </svg>
    );
  }
  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg {...props}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={1.5} />
      <path
        d="M16.5829 9.66667C15.8095 8.09697 14.043 7 11.9876 7C9.38854 7 7.25148 8.75408 7 11"
        {...stroke}
      />
      <path
        d="M14.4939 9.72222H16.4001C16.7315 9.72222 17.0001 9.45359 17.0001 9.12222V7.5"
        {...stroke}
      />
      <path
        d="M7.41707 13.6667C8.19054 15.6288 9.95698 17 12.0124 17C14.6115 17 16.7485 14.8074 17 12"
        {...stroke}
      />
      <path
        d="M9.5061 13.6222H7.59992C7.26855 13.6222 6.99992 13.8909 6.99992 14.2222V16.4"
        {...stroke}
      />
    </svg>
  );
}

function SettingsIcon() {
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
  return (
    <svg {...props}>
      <path
        d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z"
        {...stroke}
      />
      <path
        d="M19.6224 10.3954L18.5247 7.7448L20 6L18 4L16.2647 5.48295L13.5578 4.36974L12.9353 2H10.981L10.3491 4.40113L7.70441 5.51596L6 4L4 6L5.45337 7.78885L4.3725 10.4463L2 11V13L4.40111 13.6555L5.51575 16.2997L4 18L6 20L7.79116 18.5403L10.397 19.6123L11 22H13L13.6045 19.6132L16.2551 18.5155C16.6969 18.8313 18 20 18 20L20 18L18.5159 16.2494L19.6139 13.598L21.9999 12.9772L22 11L19.6224 10.3954Z"
        {...stroke}
      />
    </svg>
  );
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
    case "statistics":
      return (
        <svg {...props}>
          <path d="M4 20V10" {...stroke} />
          <path d="M10 20V4" {...stroke} />
          <path d="M16 20v-7" {...stroke} />
          <path d="M3 20h17" {...stroke} />
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
  onRequestCancelSync,
  onToggleSidebar,
  collapsed = false,
  pomodoroTick = null,
}: SidebarProps) {
  const { t } = useI18n();
  const [syncing, setSyncing] = useState(false);
  useEffect(() => subscribeSyncActivity(setSyncing), []);
  const syncLabel = syncing ? t("nav.syncing") : t("nav.sync");
  const onSync = () => {
    if (syncing) onRequestCancelSync();
    else requestManualSync();
  };
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
        <div className="sidebar-dock">
          <button
            type="button"
            className={`nav-icon-btn sidebar-sync-btn${syncing ? " is-syncing" : ""}`}
            onClick={onSync}
            aria-label={syncLabel}
            title={syncLabel}
            aria-busy={syncing}
          >
            <SyncIcon busy={syncing} />
          </button>
          <button
            type="button"
            className="nav-icon-btn sidebar-settings-icon"
            onClick={onOpenSettings}
            aria-label={t("common.settings")}
            title={t("common.settings")}
          >
            <SettingsIcon />
          </button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="sidebar">
      <div className="brand">
        <img
          className="brand-mark"
          src="/brand-mark.png"
          alt=""
          width={32}
          height={32}
          decoding="async"
          aria-hidden
        />
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
          className={`sidebar-settings-btn sidebar-sync-btn${syncing ? " is-syncing" : ""}`}
          onClick={onSync}
          aria-label={syncLabel}
          aria-busy={syncing}
        >
          <SyncIcon busy={syncing} />
          <span>{syncLabel}</span>
        </button>
        <button
          type="button"
          className="sidebar-settings-btn"
          onClick={onOpenSettings}
          aria-label={t("common.settings")}
        >
          <SettingsIcon />
          <span>{t("common.settings")}</span>
        </button>
        <p className="sidebar-version">v{APP_VERSION}</p>
      </div>
    </aside>
  );
}
