import { afterEach, describe, expect, it } from "vitest";
import { findNode, initialNodes, loadNodes, saveNodes, upsertNode } from "./nodes";
import type { SavedNode } from "./nodes";
import { saveDeviceToken } from "./settings";

const UBUNTU: SavedNode = {
  id: "a",
  name: "Ubuntu",
  host: "192.168.1.3",
  port: 49777,
  token: "t1",
};
const LOCAL: SavedNode = { id: "b", name: "This PC", host: "127.0.0.1", port: 49777, token: "" };

afterEach(() => {
  localStorage.clear();
});

describe("saved nodes", () => {
  it("round-trips through localStorage and drops malformed entries", () => {
    saveNodes([UBUNTU]);
    expect(loadNodes()).toEqual([UBUNTU]);
    localStorage.setItem("gravity.nodes", JSON.stringify([UBUNTU, { id: "x", host: "" }, 3]));
    expect(loadNodes()).toEqual([UBUNTU]);
    localStorage.setItem("gravity.nodes", "not json");
    expect(loadNodes()).toEqual([]);
  });

  it("seeds the list with the current connection and its device token", () => {
    saveDeviceToken("t1");
    const nodes = initialNodes({ host: "192.168.1.3", port: 49777 });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ name: "192.168.1.3", host: "192.168.1.3", token: "t1" });
  });

  it("keeps a stored list instead of seeding", () => {
    saveNodes([LOCAL]);
    expect(initialNodes({ host: "192.168.1.3", port: 49777 })).toEqual([LOCAL]);
  });

  it("replaces a node with the same endpoint on upsert", () => {
    const renamed = { ...UBUNTU, id: "c", name: "Ubuntu box", token: "t2" };
    expect(upsertNode([UBUNTU, LOCAL], renamed)).toEqual([LOCAL, renamed]);
  });

  it("finds the node matching an endpoint", () => {
    expect(findNode([UBUNTU, LOCAL], { host: "127.0.0.1", port: 49777 })).toBe(LOCAL);
    expect(findNode([UBUNTU, LOCAL], { host: "127.0.0.1", port: 1 })).toBeUndefined();
  });
});
