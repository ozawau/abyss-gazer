import { useEffect, useRef, useState } from "react";
import type { Category } from "../lib/api";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { useI18n } from "./LocaleProvider";

interface CategoryPickerProps {
  categories: Category[];
  value: string | null;
  disabled?: boolean;
  onChange: (categoryId: string | null) => void;
  onRequestCreate?: () => void;
  onRequestEdit?: (category: Category) => void;
  compact?: boolean;
}

export function CategoryPicker({
  categories,
  value,
  disabled,
  onChange,
  onRequestCreate,
  onRequestEdit,
  compact,
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useDismissOnAndroidBack(open, () => setOpen(false), rootRef);

  const selected = categories.find((c) => c.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      className={`category-picker${compact ? " is-compact" : ""}${open ? " is-open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="category-picker-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <>
            <span
              className="category-swatch"
              style={{ background: selected.color }}
              aria-hidden
            />
            <span className="category-picker-label">{selected.name}</span>
          </>
        ) : (
          <span className="category-picker-label is-muted">{t("category.none")}</span>
        )}
        <span className="category-picker-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="category-picker-menu" role="listbox">
          <button
            type="button"
            className={`category-option${!value ? " is-active" : ""}`}
            role="option"
            aria-selected={!value}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
          >
            <span className="category-swatch is-empty" aria-hidden />
            {t("category.none")}
          </button>
          {categories.map((c) => (
            <div
              key={c.id}
              className={`category-option-row${value === c.id ? " is-active" : ""}`}
            >
              <button
                type="button"
                className="category-option"
                role="option"
                aria-selected={value === c.id}
                onClick={() => {
                  onChange(c.id);
                  setOpen(false);
                }}
              >
                <span
                  className="category-swatch"
                  style={{ background: c.color }}
                  aria-hidden
                />
                {c.name}
              </button>
              {onRequestEdit && (
                <button
                  type="button"
                  className="category-option-edit"
                  title={t("category.edit")}
                  aria-label={t("category.editNamed", { name: c.name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpen(false);
                    onRequestEdit(c);
                  }}
                >
                  {t("common.edit")}
                </button>
              )}
            </div>
          ))}
          {onRequestCreate && (
            <button
              type="button"
              className="category-option category-option-add"
              onClick={() => {
                setOpen(false);
                onRequestCreate();
              }}
            >
              + {t("category.add")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
