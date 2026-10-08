import type { GroupItem } from "../groups/groupChat";

/** A group's newest message and how many bot replies arrived since it was last open. */
export interface GroupActivity {
  readonly at: string;
  readonly unread: number;
}

/** `seenAt` undefined means never tracked: nothing counts as unread yet. */
export function summarize(
  thread: readonly GroupItem[],
  seenAt: string | undefined,
): GroupActivity | undefined {
  const last = thread.at(-1);
  if (last === undefined) {
    return undefined;
  }
  const seen = seenAt === undefined ? Number.POSITIVE_INFINITY : Date.parse(seenAt);
  const unread = thread.filter(
    (entry) => entry.bot !== undefined && Date.parse(entry.item.at) > seen,
  ).length;
  return { at: last.item.at, unread };
}
