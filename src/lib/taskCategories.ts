import type { Category, SystemSettings, Task } from "./api";

export function resolveCheckinCategoryId(
  settings: SystemSettings,
  categories: Category[],
): string | null {
  const id = settings.checkinCategoryId;
  if (!id) return null;
  return categories.some((c) => c.id === id) ? id : null;
}

export function resolveNoteCategoryId(
  settings: SystemSettings,
  categories: Category[],
): string | null {
  const id = settings.noteCategoryId;
  if (!id) return null;
  return categories.some((c) => c.id === id) ? id : null;
}

export function categoryNameById(
  categories: Category[],
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  return categories.find((c) => c.id === id)?.name ?? null;
}

export function isCheckinRootTask(
  task: Task,
  checkinCategoryId: string | null,
): boolean {
  if (task.parent_id || !checkinCategoryId) return false;
  return task.category_id === checkinCategoryId;
}
