import { useEffect, useState } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { Bot, BotActivity, BotGroup, ChatItem } from "../../protocol/entities";
import type { GroupItem } from "../groups/groupChat";
import { mergeThreads } from "../groups/groupChat";
import type { GroupActivity } from "./groupActivity";
import { summarize } from "./groupActivity";

const SEEN_KEY = "gravity.groupSeen";
const SETTLE_MS = 1500;

function readSeen(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  } catch {
    return {};
  }
}

function writeSeen(seen: Readonly<Record<string, string>>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // A blocked storage only costs the badges after a reload.
  }
}

/**
 * Each group's newest message and unread bot replies, rebuilt from the members'
 * chats whenever one of them has news. The open group counts as read.
 */
export function useGroupActivity(
  client: DaemonApi,
  groups: readonly BotGroup[],
  bots: readonly Bot[],
  activityByBot: Readonly<Record<string, BotActivity>>,
  openGroupId: string | null,
): Readonly<Record<string, GroupActivity>> {
  const [threads, setThreads] = useState<Readonly<Record<string, readonly GroupItem[]>>>({});
  const [seen, setSeen] = useState<Readonly<Record<string, string>>>(readSeen);
  const key = groups
    .map(
      (group) => `${group.id}:${group.bot_ids.map((id) => activityByBot[id]?.at ?? "").join("|")}`,
    )
    .join(";");

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const chats = new Map<string, Promise<readonly ChatItem[]>>();
        const chatOf = (botId: string): Promise<readonly ChatItem[]> => {
          const cached = chats.get(botId);
          if (cached !== undefined) {
            return cached;
          }
          const loading = client
            .request({ type: "get_chat", bot_id: botId }, "chat")
            .then((reply) => reply.items)
            .catch(() => [] as readonly ChatItem[]);
          chats.set(botId, loading);
          return loading;
        };
        const entries = await Promise.all(
          groups.map(async (group) => {
            const members = bots.filter((bot) => group.bot_ids.includes(bot.id));
            const loaded = await Promise.all(
              members.map(async (bot) => ({ bot, items: await chatOf(bot.id) })),
            );
            return [group.id, mergeThreads(group, loaded)] as const;
          }),
        );
        const next: Record<string, readonly GroupItem[]> = Object.fromEntries(entries);
        if (alive) {
          setThreads(next);
        }
      })();
    }, SETTLE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // `key` stands for the groups and their members' activity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, bots.length]);

  // The open group is read up to its newest message; a group seen for the
  // first time starts read, so old history raises no badge.
  useEffect(() => {
    const updates: Record<string, string> = {};
    for (const [id, thread] of Object.entries(threads)) {
      const last = thread.at(-1)?.item.at;
      if (
        last !== undefined &&
        (seen[id] === undefined || (id === openGroupId && Date.parse(seen[id]) < Date.parse(last)))
      ) {
        updates[id] = last;
      }
    }
    if (Object.keys(updates).length > 0) {
      const merged = { ...seen, ...updates };
      setSeen(merged);
      writeSeen(merged);
    }
  }, [threads, openGroupId, seen]);

  const out: Record<string, GroupActivity> = {};
  for (const [id, thread] of Object.entries(threads)) {
    const summary = summarize(thread, seen[id]);
    if (summary !== undefined) {
      out[id] = summary;
    }
  }
  return out;
}
