export type ViewId =
  | "checkin"
  | "tasks"
  | "pomodoro"
  | "calendar"
  | "gantt"
  | "statistics";

export interface NavItem {
  id: ViewId;
  label: string;
  enabled: boolean;
  /** Whether this nav item has a collapsible sub-menu rail. */
  hasSubNav?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "checkin", label: "打卡", enabled: true },
  { id: "tasks", label: "任务", enabled: true, hasSubNav: true },
  { id: "pomodoro", label: "番茄钟", enabled: true },
  { id: "calendar", label: "日历", enabled: true },
  { id: "gantt", label: "甘特图", enabled: true },
  { id: "statistics", label: "统计", enabled: true },
];
