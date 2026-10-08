import { describe, expect, it } from "vitest";
import { filePaths } from "./downloads";

describe("filePaths", () => {
  it("finds absolute file paths in plain text and code spans", () => {
    const text =
      "Report in `/home/f/.gravity/projects/u/artifacts/t1-report.md`, data at /tmp/out/a.csv.";
    expect(filePaths(text)).toEqual([
      "/home/f/.gravity/projects/u/artifacts/t1-report.md",
      "/tmp/out/a.csv",
    ]);
  });

  it("ignores directories, URLs and repeats", () => {
    expect(filePaths("see /home/f/dir/ and https://x.io/a.js and /a/b.txt /a/b.txt")).toEqual([
      "/a/b.txt",
    ]);
  });
});
