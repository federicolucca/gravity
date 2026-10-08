import type { Bot, BotActivity, BotGroup, BotState, SidebarFolder } from "../../protocol/entities";
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

/** A folder with the rows it holds, newest first, and the stamp it sorts by. */
interface FolderEntry {
  readonly kind: "folder";
  readonly folder: SidebarFolder;
  readonly rows: readonly SidebarRow[];
  readonly stamp: number;
}

export type SidebarEntry = SidebarRow | FolderEntry;

/** The key a folder stores a row under. */
export function rowKey(row: SidebarRow): string {
  return row.kind === "bot" ? `bot:${row.bot.id}` : `group:${row.group.id}`;
}

/** Live bots sort above everything, so their stamp is infinite. */
function rowStamp(
  row: SidebarRow,
  activity: Readonly<Record<string, BotActivity>>,
  groupActivity: Readonly<Record<string, GroupActivity>>,
): number {
  if (row.kind === "group") {
    return stampOf(groupActivity[row.group.id]?.at);
  }
  return LIVE.has(row.bot.state) ? Number.POSITIVE_INFINITY : stampOf(activity[row.bot.id]?.at);
}

/**
 * Pulls the rows each folder holds out of the ordered list and slots the
 * folders back in by their newest row, like any other row. Rows keep their order inside.
 */
export function withFolders(
  rows: readonly SidebarRow[],
  folders: readonly SidebarFolder[],
  activity: Readonly<Record<string, BotActivity>>,
  groupActivity: Readonly<Record<string, GroupActivity>>,
): readonly SidebarEntry[] {
  const owner = new Map<string, string>();
  for (const folder of folders) {
    for (const item of folder.items) {
      owner.set(item, folder.id);
    }
  }
  const loose = rows.filter((row) => !owner.has(rowKey(row)));
  const pending = folders
    .map((folder): FolderEntry => {
      const held = rows.filter((row) => owner.get(rowKey(row)) === folder.id);
      return {
        kind: "folder",
        folder,
        rows: held,
        stamp: Math.max(0, ...held.map((row) => rowStamp(row, activity, groupActivity))),
      };
    })
    .toSorted((a, b) => b.stamp - a.stamp || a.folder.name.localeCompare(b.folder.name));
  const entries: SidebarEntry[] = [];
  for (const row of loose) {
    const at = rowStamp(row, activity, groupActivity);
    while (pending.length > 0 && pending[0].stamp > at) {
      entries.push(pending.shift() as FolderEntry);
    }
    entries.push(row);
  }
  return [...entries, ...pending];
}

/** What a collapsed folder shows: its newest message time and its unread total. */
export function folderSummary(
  rows: readonly SidebarRow[],
  activity: Readonly<Record<string, BotActivity>>,
  groupActivity: Readonly<Record<string, GroupActivity>>,
  unreadBots: Readonly<Record<string, number>>,
): { readonly at: string | undefined; readonly unread: number } {
  let at: string | undefined;
  let unread = 0;
  for (const row of rows) {
    const stamp = row.kind === "bot" ? activity[row.bot.id]?.at : groupActivity[row.group.id]?.at;
    if (stamp !== undefined && (at === undefined || Date.parse(stamp) > Date.parse(at))) {
      at = stamp;
    }
    unread +=
      row.kind === "bot"
        ? (unreadBots[row.bot.id] ?? 0)
        : (groupActivity[row.group.id]?.unread ?? 0);
  }
  return { at, unread };
}

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
