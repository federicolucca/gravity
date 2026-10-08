import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import OverlayShell from "../overlay/OverlayShell";

interface FolderNameDialogProps {
  readonly title: string;
  readonly initial: string;
  readonly onSave: (name: string) => Promise<void>;
  readonly onCancel: () => void;
}

/** Names a new sidebar folder, or renames one. */
export default function FolderNameDialog({
  title,
  initial,
  onSave,
  onCancel,
}: FolderNameDialogProps): ReactElement {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  return (
    <OverlayShell label={title} onClose={onCancel}>
      <form
        className="confirm-dialog group-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "" || saving) {
            return;
          }
          setSaving(true);
          setError(null);
          onSave(name.trim()).catch((failure: unknown) => {
            setError(failure instanceof Error ? failure.message : String(failure));
            setSaving(false);
          });
        }}
      >
        <h2 className="confirm-title">{title}</h2>
        <label className="group-dialog-label" htmlFor="folder-name">
          Name
        </label>
        <input
          id="folder-name"
          className="group-dialog-name"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        {error !== null ? <p className="chat-error">{error}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="btn btn-small" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-small btn-primary"
            disabled={name.trim() === "" || saving}
          >
            Save
          </button>
        </div>
      </form>
    </OverlayShell>
  );
}
