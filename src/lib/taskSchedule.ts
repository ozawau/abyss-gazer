import type { Task } from "./api";

/** Task is visible on the current list when start_at is empty or already reached. */
export function isTaskStarted(task: Task, nowMs = Date.now()): boolean {
  return task.start_at == null || task.start_at <= nowMs;
}

/** Todo task scheduled for the future. */
export function isTaskUpcoming(task: Task, nowMs = Date.now()): boolean {
  return (
    task.status === "todo" &&
    task.start_at != null &&
    task.start_at > nowMs
  );
}
