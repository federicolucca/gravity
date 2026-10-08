import type { Bot, BotActivity } from "../../protocol/entities";

/** A ready bot that has said nothing for this long reads as idle, not free. */
const IDLE_AFTER_MS = 30 * 60 * 1000;

/** The dot colour: green free, orange busy, blue idle, red disconnected. */
type StatusTone = "free" | "busy" | "idle" | "down";

export interface BotStatus {
  readonly tone: StatusTone;
  readonly label: string;
  /** The bot is waiting on the owner. */
  readonly needsYou: boolean;
}

function isIdle(activity: BotActivity | undefined, now: number): boolean {
  return activity === undefined || now - Date.parse(activity.at) > IDLE_AFTER_MS;
}

/** The line under a bot's name and the colour of its dot. */
export function botStatus(
  bot: Bot,
  activity: BotActivity | undefined,
  action: string | undefined,
  now: number = Date.now(),
): BotStatus {
  switch (bot.state) {
    case "working":
      return { tone: "busy", label: action ?? "Working", needsYou: false };
    case "ready":
      return isIdle(activity, now)
        ? { tone: "idle", label: "Idle", needsYou: false }
        : { tone: "free", label: "Free", needsYou: false };
    case "waiting_for_user":
      return { tone: "busy", label: "Waiting for you", needsYou: true };
    case "waiting_for_approval":
      return { tone: "busy", label: "Needs your approval", needsYou: true };
    case "rate_limited":
      return { tone: "busy", label: "Rate limited", needsYou: false };
    case "starting":
      return { tone: "busy", label: "Starting", needsYou: false };
    case "stopping":
      return { tone: "busy", label: "Stopping", needsYou: false };
    case "auth_failed":
      return { tone: "down", label: "Signed out", needsYou: true };
    case "crashed":
      return { tone: "down", label: "Crashed", needsYou: false };
    case "stopped":
      return { tone: "down", label: "Disconnected", needsYou: false };
  }
}
