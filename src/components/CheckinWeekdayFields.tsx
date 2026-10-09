import { WEEKDAY_FULL } from "../lib/i18n";
import { OptionPicker } from "./OptionPicker";
import { useI18n } from "./LocaleProvider";

interface CheckinWeekdayFieldsProps {
  everyDay: boolean;
  days: number[];
  disabled?: boolean;
  onEveryDayChange: (everyDay: boolean) => void;
  onDaysChange: (days: number[]) => void;
}

export function CheckinWeekdayFields({
  everyDay,
  days,
  disabled,
  onEveryDayChange,
  onDaysChange,
}: CheckinWeekdayFieldsProps) {
  const { locale, t } = useI18n();
  return (
    <div className="task-detail-repeat-row">
      <OptionPicker
        value={everyDay ? "all" : "custom"}
        disabled={disabled}
        ariaLabel={t("checkin.schedule")}
        options={[
          { value: "all", label: t("checkin.everyDay") },
          { value: "custom", label: t("checkin.chosenDays") },
        ]}
        onChange={(value) => {
          onEveryDayChange(value === "all");
          if (value === "custom" && days.length === 0) onDaysChange([1, 2, 3, 4, 5, 6, 0]);
        }}
      />
      {!everyDay && (
        <OptionPicker
          multiple
          values={days.map(String)}
          disabled={disabled}
          ariaLabel={t("checkin.chosenDays")}
          options={[1, 2, 3, 4, 5, 6, 0].map((day) => ({
            value: String(day),
            label: WEEKDAY_FULL[locale][day] ?? "",
          }))}
          onValuesChange={(values) => onDaysChange(values.map(Number))}
        />
      )}
    </div>
  );
}
