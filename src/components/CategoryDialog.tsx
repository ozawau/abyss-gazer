import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Category } from "../lib/api";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { useI18n } from "./LocaleProvider";

export const CATEGORY_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#475569",
];

interface CategoryDialogProps {
  open: boolean;
  initial?: Category | null;
  onClose: () => void;
  onSubmit: (name: string, color: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function CategoryDialog({
  open,
  initial = null,
  onClose,
  onSubmit,
  onDelete,
}: CategoryDialogProps) {
  const isEdit = !!initial;
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useDismissOnAndroidBack(open, () => {
    if (!busy) onClose();
  }, rootRef);
  useDismissOnAndroidBack(open && confirmDelete, () => {
    if (!busy) setConfirmDelete(false);
  }, confirmRef);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setColor(
      initial?.color && CATEGORY_COLORS.includes(initial.color)
        ? initial.color
        : initial?.color ?? CATEGORY_COLORS[0],
    );
    setError(null);
    setBusy(false);
    setConfirmDelete(false);
  }, [open, initial]);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed, color);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!onDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (err) {
      setError(String(err));
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  const colors = CATEGORY_COLORS.includes(color)
    ? CATEGORY_COLORS
    : [color, ...CATEGORY_COLORS];

  return (
    <div ref={rootRef} className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="category-dialog-title">{isEdit ? t("category.edit") : t("category.add")}</h2>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>{t("category.name")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("category.namePlaceholder")}
              autoFocus
              disabled={busy}
            />
          </label>

          <div className="field">
            <span>{t("category.color")}</span>
            <div className="color-grid" role="radiogroup" aria-label={t("category.colorLabel")}>
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-chip${color === c ? " is-selected" : ""}`}
                  style={{ background: c }}
                  aria-label={c}
                  aria-checked={color === c}
                  role="radio"
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {confirmDelete && (
            <div ref={confirmRef} className="delete-confirm">
              <p>
                {t("category.deleteBody", { name: initial?.name ?? "" })}
              </p>
              <div className="delete-confirm-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busy}
                  onClick={() => void handleDeleteConfirm()}
                >
                  {t("common.confirmDelete")}
                </button>
              </div>
            </div>
          )}

          {error && <p className="error-banner">{error}</p>}

          {!confirmDelete && (
            <div className="modal-actions">
              {isEdit && onDelete && (
                <button
                  type="button"
                  className="danger-btn modal-delete"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                >
                  {t("common.delete")}
                </button>
              )}
              <button
                type="button"
                className="secondary-btn"
                onClick={onClose}
                disabled={busy}
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="primary-btn"
                disabled={busy || !name.trim()}
              >
                {isEdit ? t("common.save") : t("common.create")}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
