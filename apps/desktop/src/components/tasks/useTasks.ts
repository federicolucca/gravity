import { useCallback, useEffect, useState } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { BotTask, TaskDraft, TaskStatus } from "../../protocol/entities";

const POLL_MS = 3000;

export interface TasksApi {
  readonly tasks: readonly BotTask[] | null;
  readonly paused: boolean;
  readonly error: string | null;
  readonly add: (draft: TaskDraft) => Promise<void>;
  readonly edit: (taskId: string, draft: TaskDraft) => Promise<void>;
  readonly move: (taskId: string, status: TaskStatus, beforeId?: string) => void;
  readonly remove: (taskId: string) => void;
  readonly setPaused: (paused: boolean) => void;
}

type Board = { readonly tasks: readonly BotTask[]; readonly paused: boolean };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A bot's task board, polled while shown; the daemon moves tasks on its own. */
export function useTasks(client: DaemonApi, botId: string, connected: boolean): TasksApi {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) {
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const load = async (): Promise<void> => {
      try {
        const reply = await client.request({ type: "list_tasks", bot_id: botId }, "tasks");
        if (alive) {
          setBoard({ tasks: reply.tasks, paused: reply.paused });
        }
      } catch (failure) {
        if (alive) {
          setError(message(failure));
        }
      }
      if (alive) {
        timer = window.setTimeout(() => {
          void load();
        }, POLL_MS);
      }
    };
    void load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [client, botId, connected]);

  const run = useCallback(
    async (request: Parameters<DaemonApi["request"]>[0]): Promise<void> => {
      try {
        const reply = await client.request(request, "tasks");
        setBoard({ tasks: reply.tasks, paused: reply.paused });
        setError(null);
      } catch (failure) {
        setError(message(failure));
        throw failure;
      }
    },
    [client],
  );

  return {
    tasks: board?.tasks ?? null,
    paused: board?.paused ?? false,
    error,
    add: (draft) => run({ type: "save_task", bot_id: botId, ...draft }),
    edit: (taskId, draft) => run({ type: "save_task", bot_id: botId, task_id: taskId, ...draft }),
    move: (taskId, status, beforeId) => {
      setBoard((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              tasks: prev.tasks.map((task) => (task.id === taskId ? { ...task, status } : task)),
            },
      );
      void run({
        type: "move_task",
        bot_id: botId,
        task_id: taskId,
        status,
        ...(beforeId === undefined ? {} : { before_id: beforeId }),
      }).catch(() => undefined);
    },
    remove: (taskId) => {
      void run({ type: "delete_task", bot_id: botId, task_id: taskId }).catch(() => undefined);
    },
    setPaused: (paused) => {
      void run({ type: "pause_tasks", bot_id: botId, paused }).catch(() => undefined);
    },
  };
}
