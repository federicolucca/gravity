import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import type { BotTask, TaskDraft } from "../../protocol/entities";
import { modelBadge } from "./modelBadge";
import TaskForm from "./TaskForm";

function when(task: BotTask): string | null {
  const at = task.done_at ?? task.started_at;
  if (at === undefined) {
    return null;
  }
  const verb = task.done_at === undefined ? "Started" : "Done";
  return `${verb} ${new Date(at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`;
}

export default function TaskCard({
  task,
  canControl,
  onEdit,
  onRemove,
}: {
  readonly task: BotTask;
  readonly canControl: boolean;
  readonly onEdit: (draft: TaskDraft) => Promise<void>;
  readonly onRemove: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  if (editing) {
    return (
      <TaskForm
        initial={task}
        submitLabel="Save"
        onSubmit={async (draft) => {
          await onEdit(draft);
          setEditing(false);
        }}
        onCancel={() => {
          setEditing(false);
        }}
      />
    );
  }
  const stamp = when(task);
  const badge = modelBadge(task);
  return (
    <div
      className={`task-card task-card-${task.status}`}
      draggable={canControl}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/x-gravity-task", task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      data-task-id={task.id}
    >
      <div className="task-card-head">
        <button
          type="button"
          className="task-card-title"
          aria-expanded={open}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          {task.title}
        </button>
        <span className="task-card-model" title={badge.title}>
          {badge.label}
        </span>
        {canControl ? (
          <span className="task-card-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label={`Edit ${task.title}`}
              onClick={() => {
                setEditing(true);
              }}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Delete ${task.title}`}
              onClick={onRemove}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>
      {open ? (
        <>
          {task.body === "" ? null : <p>{task.body}</p>}
          {task.comment === undefined ? null : <p className="task-card-comment">{task.comment}</p>}
          {stamp === null ? null : <span className="task-card-when">{stamp}</span>}
        </>
      ) : null}
    </div>
  );
}
