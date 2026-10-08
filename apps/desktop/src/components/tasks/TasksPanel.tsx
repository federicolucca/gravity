import { useState } from "react";
import type { DragEvent, ReactElement } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { Bot, BotTask, TaskStatus } from "../../protocol/entities";
import PanelHeader from "../PanelHeader";
import TaskCard from "./TaskCard";
import TaskForm from "./TaskForm";
import { useTasks } from "./useTasks";

const COLUMNS: readonly { readonly status: TaskStatus; readonly label: string }[] = [
  { status: "todo", label: "Todo" },
  { status: "progress", label: "In progress" },
  { status: "done", label: "Done" },
];

const DRAG_TYPE = "text/x-gravity-task";

/** The card a drop lands before: the first one whose middle is below the pointer. */
function beforeId(event: DragEvent<HTMLElement>, cards: readonly BotTask[]): string | undefined {
  const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-task-id]")];
  const hit = nodes.find((node) => {
    const box = node.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2;
  });
  const id = hit?.dataset.taskId;
  return cards.some((task) => task.id === id) ? id : undefined;
}

interface TasksPanelProps {
  readonly client: DaemonApi;
  readonly bot: Bot;
  readonly connected: boolean;
  readonly canControl: boolean;
}

/**
 * A bot's work queue as three columns. The daemon hands the top todo to the
 * bot whenever it sits idle and moves it along; cards can be dragged between
 * columns or reordered by hand.
 */
export default function TasksPanel({
  client,
  bot,
  connected,
  canControl,
}: TasksPanelProps): ReactElement {
  const api = useTasks(client, bot.id, connected);
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState<TaskStatus | null>(null);
  const tasks = api.tasks ?? [];

  return (
    <div className="panel tasks-panel">
      <PanelHeader title="Tasks">
        {canControl ? (
          <>
            <label className="tasks-auto">
              <input
                type="checkbox"
                checked={!api.paused}
                disabled={!connected}
                onChange={(event) => {
                  api.setPaused(!event.target.checked);
                }}
              />
              Auto-start when idle
            </label>
            <button
              type="button"
              className="btn btn-small btn-primary"
              disabled={!connected}
              onClick={() => {
                setAdding(true);
              }}
            >
              + New task
            </button>
          </>
        ) : null}
      </PanelHeader>
      <p className="muted tasks-help">
        {api.paused
          ? "Paused: queued tasks wait until auto-start is back on."
          : `${bot.name} gets the top Todo whenever it is idle, one at a time.`}
      </p>
      {api.error === null ? null : <p className="chat-error">{api.error}</p>}

      <div className="tasks-board">
        {COLUMNS.map((column) => {
          const cards = tasks.filter((task) => task.status === column.status);
          return (
            <div
              key={column.status}
              className={`tasks-column${over === column.status ? " tasks-column-over" : ""}`}
              onDragOver={(event) => {
                if (canControl && event.dataTransfer.types.includes(DRAG_TYPE)) {
                  event.preventDefault();
                  setOver(column.status);
                }
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setOver(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                setOver(null);
                const id = event.dataTransfer.getData(DRAG_TYPE);
                if (id !== "") {
                  const before = beforeId(event, cards);
                  api.move(id, column.status, before === id ? undefined : before);
                }
              }}
            >
              <header className="tasks-column-head">
                <span>{column.label}</span>
                <span className="tasks-count">{cards.length}</span>
              </header>
              {column.status === "todo" && adding ? (
                <TaskForm
                  submitLabel="Add"
                  onSubmit={api.add}
                  onCancel={() => {
                    setAdding(false);
                  }}
                />
              ) : null}
              {cards.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  canControl={canControl}
                  onEdit={(draft) => api.edit(task.id, draft)}
                  onRemove={() => {
                    api.remove(task.id);
                  }}
                />
              ))}
              {cards.length === 0 && !(column.status === "todo" && adding) ? (
                <p className="tasks-empty">{column.status === "todo" ? "Nothing queued." : "—"}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
