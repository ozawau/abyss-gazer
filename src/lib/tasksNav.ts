export type TasksSubPage = "active" | "upcoming" | "completed";

export interface TasksSubNavItem {
  id: TasksSubPage;
  label: string;
}

export const TASKS_SUB_NAV: TasksSubNavItem[] = [
  { id: "active", label: "当前任务" },
  { id: "upcoming", label: "未开始" },
  { id: "completed", label: "已完成" },
];
