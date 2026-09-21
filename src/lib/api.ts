import { invoke } from "@tauri-apps/api/core";

export type TaskStatus = "todo" | "done";
export type TaskPriority = "high" | "medium" | "low";
export type SessionKind = "focus" | "break";

export interface Category {
  id: string;
  name: string;
  color: string;
  created_at: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  sort_order: number;
  category_id: string | null;
  estimate_pomodoros: number;
  completed_pomodoros: number;
  due_at: number | null;
  start_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface PomodoroSession {
  id: string;
  task_id: string;
  kind: SessionKind;
  planned_seconds: number;
  started_at: number;
  ended_at: number;
  completed: boolean;
}

export function listTasks(): Promise<Task[]> {
  return invoke("list_tasks");
}

export function createTask(input: {
  title: string;
  notes?: string;
  priority?: TaskPriority;
  category_id?: string | null;
  estimate_pomodoros?: number;
}): Promise<Task> {
  return invoke("create_task", {
    input: {
      title: input.title,
      notes: input.notes ?? "",
      priority: input.priority ?? "high",
      category_id: input.category_id ?? null,
      estimate_pomodoros: input.estimate_pomodoros ?? 0,
    },
  });
}

export function updateTask(input: {
  id: string;
  title?: string;
  notes?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  category_id?: string | null;
  estimate_pomodoros?: number;
  due_at?: number | null;
  start_at?: number | null;
}): Promise<Task> {
  const payload: Record<string, unknown> = { id: input.id };
  if (input.title !== undefined) payload.title = input.title;
  if (input.notes !== undefined) payload.notes = input.notes;
  if (input.status !== undefined) payload.status = input.status;
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.category_id !== undefined) payload.category_id = input.category_id;
  if (input.estimate_pomodoros !== undefined) {
    payload.estimate_pomodoros = input.estimate_pomodoros;
  }
  if (input.due_at !== undefined) payload.due_at = input.due_at;
  if (input.start_at !== undefined) payload.start_at = input.start_at;
  return invoke("update_task", { input: payload });
}

export function reorderTask(input: {
  id: string;
  priority: TaskPriority;
  before_id?: string | null;
}): Promise<Task[]> {
  return invoke("reorder_task", {
    input: {
      id: input.id,
      priority: input.priority,
      before_id: input.before_id ?? null,
    },
  });
}

export function deleteTask(id: string): Promise<void> {
  return invoke("delete_task", { id });
}

export function getTask(id: string): Promise<Task> {
  return invoke("get_task", { id });
}

export function listCategories(): Promise<Category[]> {
  return invoke("list_categories");
}

export function createCategory(name: string, color: string): Promise<Category> {
  return invoke("create_category", { input: { name, color } });
}

export function updateCategory(input: {
  id: string;
  name?: string;
  color?: string;
}): Promise<Category> {
  return invoke("update_category", { input });
}

export function deleteCategory(id: string): Promise<void> {
  return invoke("delete_category", { id });
}

export function recordPomodoroSession(input: {
  task_id: string;
  kind: SessionKind;
  planned_seconds: number;
  started_at: number;
  ended_at: number;
  completed: boolean;
}): Promise<PomodoroSession> {
  return invoke("record_pomodoro_session", { input });
}

/** Local calendar-day start as unix ms. */
export function startOfLocalDayMs(date = new Date()): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function countFocusSessionsSince(
  taskId: string,
  sinceMs: number,
): Promise<number> {
  return invoke("count_focus_sessions_since", {
    taskId,
    sinceMs,
  });
}

export interface FocusCountRow {
  task_id: string;
  count: number;
}

export function listFocusCountsSince(sinceMs: number): Promise<FocusCountRow[]> {
  return invoke("list_focus_counts_since", { sinceMs });
}

export function countFocusSessionsTotalSince(sinceMs: number): Promise<number> {
  return invoke("count_focus_sessions_total_since", { sinceMs });
}

export interface PomodoroSettings {
  focusMinutes: number;
  breaksEnabled: boolean;
  shortBreakMinutes: number;
  longBreakEnabled: boolean;
  longBreakMinutes: number;
  longBreakInterval: number;
  autoStartFocus: boolean;
  autoStartBreak: boolean;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  breaksEnabled: true,
  shortBreakMinutes: 5,
  longBreakEnabled: true,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  autoStartFocus: false,
  autoStartBreak: false,
};

export function getPomodoroSettings(): Promise<PomodoroSettings> {
  return invoke("get_pomodoro_settings");
}

export function setPomodoroSettings(
  settings: PomodoroSettings,
): Promise<PomodoroSettings> {
  return invoke("set_pomodoro_settings", { settings });
}

export function getDbPath(): Promise<string> {
  return invoke("get_db_path");
}

export type SyncMethod = "local" | "git";
export type SyncIntervalMinutes = 5 | 10 | 30;

export interface SystemSettings {
  dataDir: string | null;
  syncEnabled: boolean;
  syncMethod: SyncMethod;
  syncIntervalMinutes: SyncIntervalMinutes;
  localBackupDir: string | null;
  gitCommitMessage: string;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  dataDir: null,
  syncEnabled: false,
  syncMethod: "local",
  syncIntervalMinutes: 10,
  localBackupDir: null,
  gitCommitMessage: "chore: sync Abyss Gazer data",
};

export function getSystemSettings(): Promise<SystemSettings> {
  return invoke("get_system_settings");
}

export function setSystemSettings(
  settings: SystemSettings,
): Promise<SystemSettings> {
  return invoke("set_system_settings", { settings });
}

export function getDefaultDataDir(): Promise<string> {
  return invoke("get_default_data_dir");
}

export function getActiveDataDir(): Promise<string> {
  return invoke("get_active_data_dir");
}

export function setDataDirectory(path: string): Promise<SystemSettings> {
  return invoke("set_data_directory", { path });
}

export function runDataSync(): Promise<void> {
  return invoke("run_data_sync");
}
