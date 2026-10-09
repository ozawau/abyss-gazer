/** Weekdays a habit must be checked in. `null` means every day. Values are `Date.getDay()` (Sunday = 0). */
export function parseCheckinWeekdays(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const days = [
    ...new Set(
      value.filter(
        (item): item is number => Number.isInteger(item) && item >= 0 && item <= 6,
      ),
    ),
  ].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return null;
  return days;
}

/** `null` when the habit is due every day, including when all seven weekdays are selected. */
export function encodeCheckinWeekdays(everyDay: boolean, days: number[]): string | null {
  if (everyDay) return null;
  const unique = [...new Set(days.filter((day) => day >= 0 && day <= 6))].sort((a, b) => a - b);
  if (unique.length === 0 || unique.length === 7) return null;
  return JSON.stringify(unique);
}

export function habitScheduledOn(raw: string | null | undefined, day: Date): boolean {
  const days = parseCheckinWeekdays(raw);
  if (!days) return true;
  return days.includes(day.getDay());
}
