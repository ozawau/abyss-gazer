import solarLunar from "solarlunar";
import { intlTag, WEEKDAY_FULL, type AppLocale } from "./i18n";

export function formatGregorianDate(date = new Date(), locale: AppLocale = "zh"): string {
  if (locale === "en") {
    return date.toLocaleDateString("en", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatWeekday(date = new Date(), locale: AppLocale = "zh"): string {
  return WEEKDAY_FULL[locale][date.getDay()] ?? "";
}

export function formatDateTime(ms: number | null | undefined, locale: AppLocale = "zh"): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleString(intlTag(locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatShortDate(ms: number, locale: AppLocale = "zh"): string {
  return new Date(ms).toLocaleDateString(intlTag(locale));
}

function lunarFromSolar(date: Date) {
  const result = solarLunar.solar2lunar(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (result === -1) return null;
  const month =
    result.isLeap && !result.monthCn.includes("闰")
      ? `闰${result.monthCn}`
      : result.monthCn;
  return { month, dayCn: result.dayCn, lMonth: result.lMonth, lDay: result.lDay };
}

export function formatLunarDate(date = new Date(), locale: AppLocale = "zh"): string {
  const lunar = lunarFromSolar(date);
  if (!lunar) return "";
  if (locale === "en") return `Lunar ${lunar.lMonth}/${lunar.lDay}`;
  return `农历${lunar.month}${lunar.dayCn}`;
}

/** Compact lunar label for calendar cells: month name on 初一, otherwise the lunar day. */
export function formatLunarDayShort(date: Date, locale: AppLocale = "zh"): string {
  const lunar = lunarFromSolar(date);
  if (!lunar) return "";
  if (locale === "en") return `${lunar.lMonth}/${lunar.lDay}`;
  return lunar.lDay === 1 ? lunar.month : lunar.dayCn;
}

/** Split minutes into hours + remaining minutes. */
export function splitDurationMinutes(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  const mins = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(mins / 60), minutes: mins % 60 };
}

/** Format minutes as a compact duration, e.g. 1小时30分 / 1h 30m. */
export function formatDurationMinutes(
  totalMinutes: number,
  locale: AppLocale = "zh",
): string {
  const { hours, minutes } = splitDurationMinutes(totalMinutes);
  if (locale === "en") {
    if (hours <= 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}m`;
  }
  if (hours <= 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分`;
}
