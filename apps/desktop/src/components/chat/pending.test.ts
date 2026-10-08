import { describe, expect, it } from "vitest";
import type { ChatItem } from "../../protocol/entities";
import { unlanded } from "./pending";

const user = (at: string, text: string): ChatItem => ({ kind: "user", at, text });
const NOW = Date.parse("2026-10-08T12:00:30Z");

describe("unlanded", () => {
  it("keeps the second prompt while only the first has landed", () => {
    const pending = [
      { at: "2026-10-08T12:00:00Z", text: "first" },
      { at: "2026-10-08T12:00:05Z", text: "second" },
    ];
    expect(unlanded(pending, [user("2026-10-08T12:00:04Z", "first")], NOW)).toEqual([pending[1]]);
  });

  it("matches two identical prompts to two messages", () => {
    const pending = [
      { at: "2026-10-08T12:00:00Z", text: "ok" },
      { at: "2026-10-08T12:00:01Z", text: "ok" },
    ];
    const items = [user("2026-10-08T12:00:04Z", "ok")];
    expect(unlanded(pending, items, NOW)).toHaveLength(1);
    expect(unlanded(pending, [...items, user("2026-10-08T12:00:09Z", "ok")], NOW)).toEqual([]);
  });

  it("ignores an older message with the same text", () => {
    const pending = [{ at: "2026-10-08T12:00:00Z", text: "ok" }];
    expect(unlanded(pending, [user("2026-10-08T11:00:00Z", "ok")], NOW)).toEqual(pending);
  });

  it("gives up on a prompt that never lands", () => {
    const pending = [{ at: "2026-10-08T11:00:00Z", text: "lost" }];
    expect(unlanded(pending, [], NOW)).toEqual([]);
  });
});

describe("attachment round trip", () => {
  it("keeps image paths readable after quoting them", async () => {
    const { promptWithAttachments, splitAttachments } = await import("./uploads");
    const prompt = promptWithAttachments("look", ["/u/20261008-120000000-shot.png"]);
    expect(prompt).toBe("look\nAttached file: `/u/20261008-120000000-shot.png`");
    expect(splitAttachments(prompt)).toEqual({
      body: "look",
      files: ["/u/20261008-120000000-shot.png"],
    });
    expect(splitAttachments("[Image #1]look\nAttached file:")).toEqual({
      body: "[Image #1]look",
      files: [],
    });
  });
});
