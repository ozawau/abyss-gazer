export type ViewId =
  | "tasks"
  | "pomodoro"
  | "schedule"
  | "calendar"
  | "gantt";

export interface NavItem {
  id: ViewId;
  label: string;
  enabled: boolean;
  /** Whether this nav item has a collapsible sub-menu rail. */
  hasSubNav?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "tasks", label: "任务", enabled: true, hasSubNav: true },
  { id: "pomodoro", label: "番茄钟", enabled: true },
  { id: "schedule", label: "日程", enabled: false },
  { id: "calendar", label: "日历", enabled: false },
  { id: "gantt", label: "甘特图", enabled: false },
];
