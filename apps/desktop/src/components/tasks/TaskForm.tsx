import { useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

/** Title and description for a new or edited task. */
export default function TaskForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly initial?: { readonly title: string; readonly body: string };
  readonly submitLabel: string;
  readonly onSubmit: (title: string, body: string) => Promise<void>;
  readonly onCancel: () => void;
}): ReactElement {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false);
  const cancelOnEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      onCancel();
    }
  };

  return (
    <form
      className="task-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() === "") {
          return;
        }
        setBusy(true);
        onSubmit(title.trim(), body.trim())
          .then(() => {
            if (initial === undefined) {
              setTitle("");
              setBody("");
            }
            return undefined;
          })
          .catch(() => undefined)
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <input
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label="Task title"
        placeholder="What should the bot do?"
        maxLength={200}
        value={title}
        onKeyDown={cancelOnEscape}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      <textarea
        aria-label="Task details"
        placeholder="Details (optional)"
        rows={3}
        value={body}
        onKeyDown={cancelOnEscape}
        onChange={(event) => {
          setBody(event.target.value);
        }}
      />
      <div className="task-form-actions">
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-small btn-primary"
          disabled={busy || title.trim() === ""}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
