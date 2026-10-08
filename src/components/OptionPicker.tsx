import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { useI18n } from "./LocaleProvider";

type OptionPickerBase<T extends string> = {
  options: { value: T; label: string }[];
  disabled?: boolean;
  ariaLabel: string;
};

type OptionPickerProps<T extends string> = OptionPickerBase<T> &
  (
    | {
        multiple?: false;
        value: T;
        onChange: (value: T) => void;
      }
    | {
        multiple: true;
        values: readonly T[];
        onValuesChange: (values: T[]) => void;
      }
  );

/** Same trigger and menu as the category picker, without a color swatch. */
export function OptionPicker<T extends string>(props: OptionPickerProps<T>) {
  const { options, disabled, ariaLabel } = props;
  const multiple = props.multiple === true;
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissOnAndroidBack(open, () => setOpen(false), menuRef);
  const selectedValues = new Set<string>(
    props.multiple ? props.values : [props.value],
  );
  const summary = options
    .filter((option) => selectedValues.has(option.value))
    .map((option) => option.label)
    .join(locale === "zh" ? "、" : ", ");

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = rootRef.current?.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(14 * 16, (openUp ? spaceAbove : spaceBelow) - 12));
      setMenuStyle({
        position: "fixed",
        left: rect.left,
        width: Math.max(rect.width, 176),
        right: "auto",
        top: openUp ? Math.max(8, rect.top - 4 - maxHeight) : rect.bottom + 4,
        bottom: "auto",
        maxHeight,
        zIndex: 90,
      });
    };
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open, options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function choose(optionValue: T) {
    if (props.multiple !== true) {
      props.onChange(optionValue);
      setOpen(false);
      return;
    }
    const current = props.values;
    const has = current.includes(optionValue);
    if (has) {
      if (current.length <= 1) return;
      props.onValuesChange(current.filter((item) => item !== optionValue));
      return;
    }
    const next = new Set<string>(current);
    next.add(optionValue);
    props.onValuesChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  }

  return (
    <div className={`category-picker${open ? " is-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="category-picker-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={summary}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="category-picker-label">{summary}</span>
        <span className="category-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="category-picker-menu"
            role="listbox"
            aria-label={ariaLabel}
            aria-multiselectable={multiple || undefined}
            style={menuStyle}
          >
            {options.map((option) => {
              const active = selectedValues.has(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`category-option${active ? " is-active" : ""}`}
                  role="option"
                  aria-selected={active}
                  onClick={() => choose(option.value)}
                >
                  {multiple && (
                    <span className="category-option-mark" aria-hidden>
                      {active ? "✓" : ""}
                    </span>
                  )}
                  {option.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
