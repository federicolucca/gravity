import { useEffect, useState } from "react";
import type { DaemonApi } from "../protocol/api";
import type { Bot } from "../protocol/entities";

/** How often working bots' current actions are re-read. */
const POLL_MS = 3000;

type Actions = Readonly<Record<string, string>>;

const NONE: Actions = {};

/**
 * What each working bot is doing right now ("Thinking", "Running · cargo test"),
 * keyed by bot id. Polled only while at least one bot is working.
 */
export function useBotActions(client: DaemonApi, bots: readonly Bot[]): Actions {
  const [actions, setActions] = useState<Actions>({});
  const anyWorking = bots.some((bot) => bot.state === "working");

  useEffect(() => {
    if (!anyWorking) {
      return undefined;
    }
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const reply = await client.request({ type: "list_bot_actions" }, "bot_actions");
        if (alive) {
          setActions(reply.actions);
        }
      } catch {
        // A daemon without the request leaves the plain state labels.
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [client, anyWorking]);

  return anyWorking ? actions : NONE;
}
