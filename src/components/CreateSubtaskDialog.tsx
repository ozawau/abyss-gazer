import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDismissOnAndroidBack } from "../lib/androidBack";
import { useI18n } from "./LocaleProvider";

interface CreateSubtaskDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
}

export function CreateSubtaskDialog({
  open,
  onClose,
  onCreate,
}: CreateSubtaskDialogProps) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  useDismissOnAndroidBack(open, () => {
    if (!busy) onClose();
  }, rootRef);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBusy(false);
    setError(null);
  }, [open]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next = title.trim();
    if (!next || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(next);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-subtask-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-subtask-title">{t("detail.createSubtask")}</h2>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className="field">
            <span>{t("common.taskName")}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("detail.subtaskName")}
              autoFocus
              disabled={busy}
            />
          </label>
          {error && <p className="error-banner">{error}</p>}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              disabled={busy}
              onClick={onClose}
            >
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary-btn" disabled={busy || !title.trim()}>
              {t("common.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
