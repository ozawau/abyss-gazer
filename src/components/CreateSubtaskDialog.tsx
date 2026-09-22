import { useEffect, useState, type FormEvent } from "react";

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
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-subtask-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="create-subtask-title">创建子任务</h2>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label className="field">
            <span>任务名称</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="输入子任务名称…"
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
              取消
            </button>
            <button type="submit" className="primary-btn" disabled={busy || !title.trim()}>
              创建
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
