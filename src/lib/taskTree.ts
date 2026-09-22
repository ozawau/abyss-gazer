import type { Task } from "./api";

export interface TaskNode {
  task: Task;
  depth: number;
  hasChildren: boolean;
}

export function taskById(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((task) => [task.id, task]));
}

export function childrenByParent(tasks: Task[]): Map<string | null, Task[]> {
  const map = new Map<string | null, Task[]>();
  for (const task of tasks) {
    const key = task.parent_id;
    const list = map.get(key) ?? [];
    list.push(task);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
  }
  return map;
}

export function childIdSet(tasks: Task[]): Set<string> {
  const parents = new Set<string>();
  for (const task of tasks) {
    if (task.parent_id) parents.add(task.parent_id);
  }
  return parents;
}

export function isLeafTask(task: Task, tasks: Task[]): boolean {
  return !childIdSet(tasks).has(task.id);
}

export function leafTasks(tasks: Task[]): Task[] {
  const parents = childIdSet(tasks);
  return tasks.filter((task) => !parents.has(task.id));
}

export function rootIdOf(task: Task, byId: Map<string, Task>): string {
  let current = task;
  const seen = new Set<string>([current.id]);
  while (current.parent_id) {
    const parent = byId.get(current.parent_id);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
  }
  return current.id;
}

export function descendantIds(rootId: string, tasks: Task[]): string[] {
  const byParent = childrenByParent(tasks);
  const ids: string[] = [];
  const stack = [...(byParent.get(rootId) ?? [])];
  while (stack.length) {
    const next = stack.pop()!;
    ids.push(next.id);
    const kids = byParent.get(next.id);
    if (kids) stack.push(...kids);
  }
  return ids;
}

/** `父任务 · 子任务`, walking from the root down to this task. */
export function formatTaskLineage(task: Task, byId: Map<string, Task>): string {
  const ancestors = ancestorTasks(task, byId);
  if (ancestors.length === 0) return task.title;
  return [...ancestors]
    .reverse()
    .map((item) => item.title)
    .concat(task.title)
    .join(" · ");
}

export function ancestorTasks(task: Task, byId: Map<string, Task>): Task[] {
  const chain: Task[] = [];
  let current = task;
  const seen = new Set<string>();
  while (current.parent_id && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parent_id);
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/** Keep visible tasks plus any ancestors so the tree still has context. */
export function withAncestors(visible: Task[], all: Task[]): Task[] {
  const byId = taskById(all);
  const kept = new Map(visible.map((task) => [task.id, task]));
  for (const task of visible) {
    for (const ancestor of ancestorTasks(task, byId)) {
      if (!kept.has(ancestor.id)) kept.set(ancestor.id, ancestor);
    }
  }
  return [...kept.values()];
}

export function applyAncestorFields(tasks: Task[], ancestor: Task): Task[] {
  const ids = new Set(descendantIds(ancestor.id, tasks));
  return tasks.map((task) => {
    if (task.id === ancestor.id) return ancestor;
    if (!ids.has(task.id)) return task;
    return {
      ...task,
      category_id: ancestor.category_id,
      priority: ancestor.priority,
    };
  });
}

export function removeTaskTree(tasks: Task[], id: string): Task[] {
  const ids = new Set([id, ...descendantIds(id, tasks)]);
  return tasks.filter((task) => !ids.has(task.id));
}

export function flattenTaskTree(
  tasks: Task[],
  collapsedIds: Set<string>,
  roots: Task[],
): TaskNode[] {
  const byParent = childrenByParent(tasks);
  const out: TaskNode[] = [];

  function walk(task: Task, depth: number) {
    const children = byParent.get(task.id) ?? [];
    out.push({
      task,
      depth,
      hasChildren: children.length > 0,
    });
    if (collapsedIds.has(task.id)) return;
    for (const child of children) walk(child, depth + 1);
  }

  for (const root of roots) walk(root, 0);
  return out;
}
