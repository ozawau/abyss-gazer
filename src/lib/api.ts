import { invoke } from "@tauri-apps/api/core";
import { notifyLocalDataChanged } from "./syncOnChange";

async function afterLocalMutation<T>(work: Promise<T>): Promise<T> {
  const result = await work;
  notifyLocalDataChanged();
  return result;
}

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
  parent_id: string | null;
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
  credit?: number;
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
  parent_id?: string | null;
}): Promise<Task> {
  return afterLocalMutation(
    invoke("create_task", {
      input: {
        title: input.title,
        notes: input.notes ?? "",
        priority: input.priority ?? "high",
        category_id: input.category_id ?? null,
        estimate_pomodoros: input.estimate_pomodoros ?? 0,
        parent_id: input.parent_id ?? null,
      },
    }),
  );
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
  return afterLocalMutation(invoke("update_task", { input: payload }));
}

export function reparentTask(input: {
  id: string;
  parent_id: string;
}): Promise<Task[]> {
  return afterLocalMutation(invoke("reparent_task", { input }));
}

export function reorderTask(input: {
  id: string;
  priority: TaskPriority;
  before_id?: string | null;
}): Promise<Task[]> {
  return afterLocalMutation(
    invoke("reorder_task", {
      input: {
        id: input.id,
        priority: input.priority,
        before_id: input.before_id ?? null,
      },
    }),
  );
}

export function deleteTask(id: string): Promise<void> {
  return afterLocalMutation(invoke("delete_task", { id }));
}

export function getTask(id: string): Promise<Task> {
  return invoke("get_task", { id });
}

export interface HabitCheckin {
  task_id: string;
  day: string;
  note: string;
}

export interface HabitCheckinItem {
  habit_id: string;
  task_id: string;
  day: string;
}

export function listHabitCheckins(
  startDay: string,
  endDay: string,
): Promise<HabitCheckin[]> {
  return invoke("list_habit_checkins", { startDay, endDay });
}

export function listHabitCheckinItems(
  startDay: string,
  endDay: string,
): Promise<HabitCheckinItem[]> {
  return invoke("list_habit_checkin_items", { startDay, endDay });
}

export function saveHabitCheckin(input: {
  taskId: string;
  day: string;
  checked: boolean;
  note: string;
  taskIds: string[];
}): Promise<void> {
  return afterLocalMutation(
    invoke("save_habit_checkin", {
      input: {
        task_id: input.taskId,
        day: input.day,
        checked: input.checked,
        note: input.note,
        task_ids: input.taskIds,
      },
    }),
  );
}

/** Returns whether the task is checked in after the toggle. */
export function toggleHabitCheckin(
  taskId: string,
  day: string,
): Promise<boolean> {
  return afterLocalMutation(invoke("toggle_habit_checkin", { taskId, day }));
}

export function listCategories(): Promise<Category[]> {
  return invoke("list_categories");
}

export function createCategory(name: string, color: string): Promise<Category> {
  return afterLocalMutation(invoke("create_category", { input: { name, color } }));
}

export function updateCategory(input: {
  id: string;
  name?: string;
  color?: string;
}): Promise<Category> {
  return afterLocalMutation(invoke("update_category", { input }));
}

export function deleteCategory(id: string): Promise<void> {
  return afterLocalMutation(invoke("delete_category", { id }));
}

export function recordPomodoroSession(input: {
  task_id: string;
  kind: SessionKind;
  planned_seconds: number;
  started_at: number;
  ended_at: number;
  completed: boolean;
  credit?: number;
}): Promise<PomodoroSession> {
  return afterLocalMutation(invoke("record_pomodoro_session", { input }));
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

export interface FirstFocusStart {
  task_id: string;
  started_at: number;
}

export function listFirstCompletedFocusStarts(): Promise<FirstFocusStart[]> {
  return invoke("list_first_completed_focus_starts");
}

export interface LastFocusEnd {
  task_id: string;
  ended_at: number;
}

export function listLastCompletedFocusEnds(): Promise<LastFocusEnd[]> {
  return invoke("list_last_completed_focus_ends");
}

export function listPomodoroSessionsInRange(
  startMs: number,
  endMs: number,
): Promise<PomodoroSession[]> {
  return invoke("list_pomodoro_sessions_in_range", {
    startMs,
    endMs,
  });
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
  focusEndSound: string | null;
  breakEndSound: string | null;
  focusEndVibrate: boolean;
  breakEndVibrate: boolean;
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
  focusEndSound: null,
  breakEndSound: null,
  focusEndVibrate: false,
  breakEndVibrate: false,
};

export function readSoundFile(path: string): Promise<number[]> {
  return invoke("read_sound_file", { path });
}

export function persistSoundFile(path: string): Promise<string> {
  return invoke("persist_sound_file", { path });
}

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

/** 0=周日 … 6=周六，与 `Date.getDay()` 一致 */
export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type LanguagePreference = "system" | "zh" | "en";

export interface SystemSettings {
  dataDir: string | null;
  syncEnabled: boolean;
  syncMethod: SyncMethod;
  syncIntervalMinutes: SyncIntervalMinutes;
  /** Desktop: sync shortly after tasks / check-ins / pomodoro data change. */
  syncOnDataChange: boolean;
  localBackupDir: string | null;
  gitCommitMessage: string;
  weekStartsOn: WeekStartsOn;
  ganttActivityMode: "discrete" | "continuous";
  launchAtLogin: boolean;
  /** `system` follows the OS language. */
  language: LanguagePreference;
  /** Wide layout only. Narrow screens keep the bottom tab bar. */
  sidebarCollapsed: boolean;
  /** Parent tasks in this category power check-in views and widgets. */
  checkinCategoryId: string | null;
  /** Note quick-add widget creates tasks in this category. */
  noteCategoryId: string | null;
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  dataDir: null,
  syncEnabled: false,
  syncMethod: "local",
  syncIntervalMinutes: 10,
  syncOnDataChange: false,
  localBackupDir: null,
  gitCommitMessage: "chore: sync Abyss Gazer data",
  weekStartsOn: 1,
  ganttActivityMode: "discrete",
  launchAtLogin: false,
  language: "system",
  sidebarCollapsed: false,
  checkinCategoryId: null,
  noteCategoryId: null,
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

export function pickDirectory(): Promise<string | null> {
  return invoke("pick_directory");
}

export function runDataSync(): Promise<void> {
  return invoke("run_data_sync");
}

export function reopenDatabase(): Promise<void> {
  return invoke("reopen_database");
}

/** Android only. True when the system pin-widget dialog was shown. */
export function requestPinCheckinWidget(): Promise<boolean> {
  return invoke("request_pin_checkin_widget");
}
