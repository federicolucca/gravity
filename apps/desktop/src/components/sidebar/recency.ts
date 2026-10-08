import type { Bot, BotActivity, BotState } from "../../protocol/entities";

/** States that put a bot at the top: it is working or waiting on the owner. */
const LIVE: ReadonlySet<BotState> = new Set<BotState>([
  "working",
  "waiting_for_user",
  "waiting_for_approval",
]);

/**
 * Bots ordered like chats: live ones first, then by their newest activity,
 * silent bots last by name.
 */
export function byRecency(
  bots: readonly Bot[],
  activity: Readonly<Record<string, BotActivity>>,
): readonly Bot[] {
  const at = (bot: Bot): number => {
    const stamp = activity[bot.id]?.at;
    return stamp === undefined ? 0 : Date.parse(stamp);
  };
  return bots.toSorted(
    (a, b) =>
      Number(LIVE.has(b.state)) - Number(LIVE.has(a.state)) ||
      at(b) - at(a) ||
      a.name.localeCompare(b.name),
  );
}
