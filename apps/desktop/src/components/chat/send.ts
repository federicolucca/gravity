import type { DaemonApi } from "../../protocol/api";

/**
 * Types a prompt into a bot's terminal. Bracketed paste keeps a multi-line
 * prompt as one message; the Enter after it is what submits, exactly as when
 * the owner types it.
 */
export function sendPrompt(client: DaemonApi, botId: string, prompt: string): void {
  client.fire({ type: "input", bot_id: botId, data: `\u001b[200~${prompt}\u001b[201~` });
  window.setTimeout(() => {
    client.fire({ type: "input", bot_id: botId, data: "\r" });
  }, 120);
}
