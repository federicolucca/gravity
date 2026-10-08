import { useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import type { TaskDraft, TaskModel } from "../../protocol/entities";

const MODELS: readonly { readonly value: TaskModel; readonly label: string }[] = [
  { value: "auto", label: "Auto model" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

/** Title, description and model for a new or edited task. */
export default function TaskForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly initial?: { readonly title: string; readonly body: string; readonly model?: TaskModel };
  readonly submitLabel: string;
  readonly onSubmit: (draft: TaskDraft) => Promise<void>;
  readonly onCancel: () => void;
}): ReactElement {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [model, setModel] = useState<TaskModel>(initial?.model ?? "auto");
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
        onSubmit({ title: title.trim(), body: body.trim(), model })
          .then(() => {
            if (initial === undefined) {
              setTitle("");
              setBody("");
              setModel("auto");
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
        <select
          aria-label="Model"
          title="Auto picks Haiku, Sonnet or Opus from the task; the bot restarts onto it and back"
          value={model}
          onKeyDown={cancelOnEscape}
          onChange={(event) => {
            setModel(event.target.value as TaskModel);
          }}
        >
          {MODELS.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
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
