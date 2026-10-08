import { describe, expect, it } from "vitest";
import { bytes, duration, level } from "./format";

describe("machine format", () => {
  it("formats bytes, durations and levels", () => {
    expect(bytes(512)).toBe("512 B");
    expect(bytes(1536)).toBe("1.5 KB");
    expect(bytes(32 * 1024 ** 3)).toBe("32.0 GB");
    expect(duration(90_061)).toBe("1d 1h");
    expect(duration(3720)).toBe("1h 2m");
    expect(level(95)).toBe("hot");
    expect(level(75)).toBe("warn");
    expect(level(10)).toBe("ok");
  });
});
