import { describe, expect, it } from "vitest";
import { chatModelNotice } from "./chatModel";

describe("chatModelNotice", () => {
  it("speaks only when the bot switches model", () => {
    expect(chatModelNotice({ switched: true, model: "claude-haiku-5-5" })).toBe(
      "Switching to haiku-5-5 for this message; back afterwards.",
    );
    expect(chatModelNotice({ switched: false })).toBeNull();
  });
});
