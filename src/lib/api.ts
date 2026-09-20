import { invoke } from "@tauri-apps/api/core";

export type TaskStatus = "todo" | "done";
export type SessionKind = "focus" | "break";

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
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

export function createTask(title: string, notes = ""): Promise<Task> {
  return invoke("create_task", { input: { title, notes } });
}

export function updateTask(input: {
  id: string;
  title?: string;
  notes?: string;
  status?: TaskStatus;
}): Promise<Task> {
  return invoke("update_task", { input });
}

export function deleteTask(id: string): Promise<void> {
  return invoke("delete_task", { id });
}

export function getTask(id: string): Promise<Task> {
  return invoke("get_task", { id });
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

export function getDbPath(): Promise<string> {
  return invoke("get_db_path");
}
