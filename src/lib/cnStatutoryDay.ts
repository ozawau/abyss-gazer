import { dayKey } from "./calendar";
import { getCnHolidayTables } from "./cnHolidayData";
import { translate, type AppLocale } from "./i18n";

export type StatutoryMark = "holiday" | "adjusted-workday";

export interface StatutoryDayInfo {
  mark: StatutoryMark;
  /** 关联假期名称（如 元旦、春节），调休上班日也会带上对应假期名 */
  holidayName?: string;
}

function holidayNameFromDetail(name: string): string | undefined {
  const parts = name.split(",");
  const cn = parts[1]?.trim();
  if (!cn || /^[A-Za-z\s]+$/.test(cn)) return undefined;
  return cn;
}

function isWeekend(date: Date): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

/** 国务院公布的法定休假日与调休工作日（仅这些日期会返回标注，普通周一至周五不标注）。 */
export function statutoryDayInfo(date: Date): StatutoryDayInfo | null {
  const key = dayKey(date);
  const { holidays, workdays } = getCnHolidayTables();

  if (key in holidays) {
    return {
      mark: "holiday",
      holidayName: holidayNameFromDetail(holidays[key]),
    };
  }

  if (isWeekend(date) && key in workdays) {
    return {
      mark: "adjusted-workday",
      holidayName: holidayNameFromDetail(workdays[key]),
    };
  }

  return null;
}

export function statutoryDayTitle(
  info: StatutoryDayInfo,
  locale: AppLocale = "zh",
): string {
  if (info.mark === "holiday") {
    return info.holidayName
      ? translate(locale, "calendar.holidayNamed", { name: info.holidayName })
      : translate(locale, "calendar.holiday");
  }
  return info.holidayName
    ? translate(locale, "calendar.adjustedNamed", { name: info.holidayName })
    : translate(locale, "calendar.adjusted");
}
