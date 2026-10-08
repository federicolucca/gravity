/** A short line when Gravity restarts the bot onto another model for a message, else null. */
export function chatModelNotice(reply: {
  readonly switched: boolean;
  readonly model?: string;
}): string | null {
  if (!reply.switched) {
    return null;
  }
  return `Switching to ${reply.model?.replace(/^claude-/, "") ?? "another model"} for this message; back afterwards.`;
}
