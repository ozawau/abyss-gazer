import solarLunar from "solarlunar";

const WEEKDAYS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

export function formatGregorianDate(date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatWeekday(date = new Date()): string {
  return WEEKDAYS[date.getDay()] ?? "";
}

export function formatLunarDate(date = new Date()): string {
  const result = solarLunar.solar2lunar(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  if (result === -1) return "";
  const month =
    result.isLeap && !result.monthCn.includes("闰")
      ? `闰${result.monthCn}`
      : result.monthCn;
  return `农历${month}${result.dayCn}`;
}

/** Split minutes into hours + remaining minutes. */
export function splitDurationMinutes(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  const mins = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(mins / 60), minutes: mins % 60 };
}

/** Format minutes as compact Chinese duration, e.g. 1小时30分 / 45分 / 0分. */
export function formatDurationMinutes(totalMinutes: number): string {
  const { hours, minutes } = splitDurationMinutes(totalMinutes);
  if (hours <= 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}小时`;
  return `${hours}小时${minutes}分`;
}
