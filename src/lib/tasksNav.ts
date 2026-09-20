export type TasksSubPage = "active" | "completed";

export interface TasksSubNavItem {
  id: TasksSubPage;
  label: string;
}

export const TASKS_SUB_NAV: TasksSubNavItem[] = [
  { id: "active", label: "当前任务" },
  { id: "completed", label: "已完成" },
];
