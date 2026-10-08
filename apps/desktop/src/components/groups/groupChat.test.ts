import { describe, expect, it } from "vitest";
import type { Bot, BotGroup, ChatItem } from "../../protocol/entities";
import { groupPrompt, mergeThreads, recipientsFor } from "./groupChat";

const bot = (id: string, name: string): Bot => ({ id, name }) as Bot;
const ada = bot("a", "Ada");
const master = bot("m", "Master of Ubuntu");
const members = [ada, master];
const group: BotGroup = {
  id: "12345678-aaaa",
  name: "Ops",
  project_id: "p",
  bot_ids: ["a", "m"],
  created_at: "2026-10-08T00:00:00Z",
};

describe("recipientsFor", () => {
  it("sends to everyone without a mention", () => {
    expect(recipientsFor("hello", members)).toEqual(members);
  });

  it("sends only to the mentioned members, matching long names", () => {
    expect(recipientsFor("@master of ubuntu check disk", members)).toEqual([master]);
    expect(recipientsFor("@Ada and @Master of Ubuntu", members)).toEqual(members);
  });
});

describe("mergeThreads", () => {
  it("keeps group turns, drops other prompts and shows the fan-out once", () => {
    const prompt = groupPrompt(group, members, members, "status?");
    const adaItems: ChatItem[] = [
      { kind: "user", at: "2026-10-08T10:00:00Z", text: "unrelated" },
      { kind: "bot", at: "2026-10-08T10:00:05Z", text: "private" },
      { kind: "user", at: "2026-10-08T11:00:00Z", text: prompt },
      { kind: "bot", at: "2026-10-08T11:00:09Z", text: "all good" },
    ];
    const masterItems: ChatItem[] = [
      { kind: "user", at: "2026-10-08T11:00:01Z", text: prompt },
      { kind: "bot", at: "2026-10-08T11:00:04Z", text: "disk 40%" },
    ];
    const merged = mergeThreads(group, [
      { bot: ada, items: adaItems },
      { bot: master, items: masterItems },
    ]);
    expect(merged.map((entry) => [entry.bot?.name ?? "owner", entry.item.text])).toEqual([
      ["owner", "status?"],
      ["Master of Ubuntu", "disk 40%"],
      ["Ada", "all good"],
    ]);
  });
});
