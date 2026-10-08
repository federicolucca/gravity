import { describe, expect, it } from "vitest";
import type { BotTask } from "../../protocol/entities";
import { modelBadge, modelName } from "./modelBadge";

const task = (extra: Partial<BotTask>): BotTask => ({
  id: "t",
  bot_id: "b",
  title: "x",
  body: "",
  status: "todo",
  created_at: "2026-10-08T00:00:00Z",
  ...extra,
});

describe("modelBadge", () => {
  it("names model families", () => {
    expect(modelName("claude-sonnet-5-5[1m]")).toBe("Sonnet");
    expect(modelName("opus")).toBe("Opus");
    expect(modelName("custom")).toBe("custom");
  });

  it("shows the choice, then what it ran with", () => {
    expect(modelBadge(task({})).label).toBe("Auto");
    expect(modelBadge(task({ model: "haiku" })).label).toBe("Haiku");
    expect(modelBadge(task({ ran_with: "claude-opus-5-5" })).label).toBe("Auto → Opus");
    expect(modelBadge(task({ model: "opus", ran_with: "claude-opus-5-5" })).label).toBe("Opus");
  });
});
