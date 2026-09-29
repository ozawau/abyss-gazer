export type CategoryFilter = "all" | "none" | string;

/** Category id implied by the list filter chip / select (not when "all" or "none"). */
export function categoryIdFromFilter(
  filter: CategoryFilter,
): string | null {
  if (filter === "all" || filter === "none") return null;
  return filter;
}
