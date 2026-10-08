import type { TaskModel } from "../../protocol/entities";

/** "bot" sends with whatever the bot runs; the rest go through `send_chat`. */
export type ChatModel = "bot" | TaskModel;

export const CHAT_MODELS: readonly { readonly value: ChatModel; readonly label: string }[] = [
  { value: "bot", label: "Bot model" },
  { value: "auto", label: "Auto" },
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];

/** The notice to show after `send_chat`, or null when nothing needs saying. */
export function chatModelNotice(reply: {
  readonly switched: boolean;
  readonly model?: string;
  readonly reason?: string;
}): string | null {
  const name = reply.model?.replace(/^claude-/, "") ?? "its model";
  if (reply.switched) {
    return `Restarting on ${name} for this message; it goes back afterwards.`;
  }
  return reply.reason === "already on that model"
    ? null
    : `Sent with the current model: ${reply.reason ?? "no switch"}.`;
}
