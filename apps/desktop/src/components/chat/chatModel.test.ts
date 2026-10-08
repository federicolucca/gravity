import { describe, expect, it } from "vitest";
import { chatModelNotice } from "./chatModel";

describe("chatModelNotice", () => {
  it("explains a switch or a skipped one", () => {
    expect(chatModelNotice({ switched: true, model: "claude-haiku-5-5" })).toBe(
      "Restarting on haiku-5-5 for this message; it goes back afterwards.",
    );
    expect(chatModelNotice({ switched: false, reason: "already on that model" })).toBeNull();
    expect(
      chatModelNotice({ switched: false, reason: "bot is busy: sent with its current model" }),
    ).toBe("Sent with the current model: bot is busy: sent with its current model.");
  });
});
