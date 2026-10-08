import type { Bot, BotActivity, BotGroup, BotState } from "../../protocol/entities";
import type { GroupActivity } from "./groupActivity";

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

function stampOf(at: string | undefined): number {
  return at === undefined ? 0 : Date.parse(at);
}

export type SidebarRow =
  | { readonly kind: "bot"; readonly bot: Bot }
  | { readonly kind: "group"; readonly group: BotGroup };

/**
 * Groups slotted among the already ordered bots by their newest message: a
 * group goes before the first idle bot that is older than it; live bots stay on top.
 */
export function withGroups(
  ordered: readonly Bot[],
  groups: readonly BotGroup[],
  activity: Readonly<Record<string, BotActivity>>,
  groupActivity: Readonly<Record<string, GroupActivity>>,
): readonly SidebarRow[] {
  const pending = groups.toSorted(
    (a, b) => stampOf(groupActivity[b.id]?.at) - stampOf(groupActivity[a.id]?.at),
  );
  const rows: SidebarRow[] = [];
  for (const bot of ordered) {
    const botAt = LIVE.has(bot.state) ? Number.POSITIVE_INFINITY : stampOf(activity[bot.id]?.at);
    while (pending.length > 0 && stampOf(groupActivity[pending[0].id]?.at) > botAt) {
      rows.push({ kind: "group", group: pending.shift() as BotGroup });
    }
    rows.push({ kind: "bot", bot });
  }
  return [...rows, ...pending.map((group): SidebarRow => ({ kind: "group", group }))];
}
