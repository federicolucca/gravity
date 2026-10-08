import { describe, expect, it } from "vitest";
import type { Bot } from "../../protocol/entities";
import type { GroupItem } from "../groups/groupChat";
import { summarize } from "./groupActivity";

const bot = { id: "b1", name: "TOOL" } as Bot;
const entry = (at: string, fromBot: boolean): GroupItem => ({
  item: { kind: fromBot ? "bot" : "user", at, text: "x" },
  ...(fromBot ? { bot } : {}),
});

describe("summarize", () => {
  it("reports the newest message and bot replies since the last visit", () => {
    const thread = [
      entry("2026-10-08T10:00:00Z", false),
      entry("2026-10-08T10:01:00Z", true),
      entry("2026-10-08T10:05:00Z", true),
    ];
    expect(summarize(thread, "2026-10-08T10:02:00Z")).toEqual({
      at: "2026-10-08T10:05:00Z",
      unread: 1,
    });
    expect(summarize(thread, undefined)?.unread).toBe(0);
    expect(summarize([], undefined)).toBeUndefined();
  });
});

function mk(id: string, state: Bot["state"]): Bot {
  return { id, name: id, state } as Bot;
}

describe("withGroups", () => {
  it("slots a group above older idle bots, below live ones", async () => {
    const { withGroups } = await import("./recency");
    const live = mk("live", "working");
    const old = mk("old", "ready");
    const rows = withGroups(
      [live, old],
      [{ id: "g", name: "CFS", project_id: "p", bot_ids: [] } as never],
      { old: { bot_id: "old", from: "", text: "", at: "2026-10-08T10:00:00Z" } },
      { g: { at: "2026-10-08T11:00:00Z", unread: 2 } },
    );
    expect(rows.map((row) => (row.kind === "bot" ? row.bot.id : row.group.id))).toEqual([
      "live",
      "g",
      "old",
    ]);
  });
});
