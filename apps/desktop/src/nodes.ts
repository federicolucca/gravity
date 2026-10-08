import { CLIENT_ID, PROTOCOL_VERSION } from "./protocol/connection";
import type { Endpoint } from "./protocol/connection";
import { loadDeviceToken, saveDeviceToken } from "./settings";

/**
 * A daemon this client knows how to reach. `token` is a device token; empty
 * means the machine's own owner token, read from disk by the Tauri shell.
 */
export interface SavedNode {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly token: string;
}

const NODES_KEY = "gravity.nodes";
const PROBE_TIMEOUT_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNode(value: unknown): value is SavedNode {
  if (!isRecord(value)) {
    return false;
  }
  const record = value;
  return (
    typeof record["id"] === "string" &&
    typeof record["name"] === "string" &&
    typeof record["host"] === "string" &&
    record["host"].length > 0 &&
    typeof record["port"] === "number" &&
    Number.isInteger(record["port"]) &&
    typeof record["token"] === "string"
  );
}

export function nodeEndpoint(node: SavedNode): Endpoint {
  return { host: node.host, port: node.port };
}

function sameEndpoint(a: Endpoint, b: Endpoint): boolean {
  return a.host === b.host && a.port === b.port;
}

/** The saved node for an endpoint, if any; endpoints are unique within the list. */
export function findNode(nodes: readonly SavedNode[], endpoint: Endpoint): SavedNode | undefined {
  return nodes.find((node) => sameEndpoint(nodeEndpoint(node), endpoint));
}

export function loadNodes(): readonly SavedNode[] {
  try {
    const raw = localStorage.getItem(NODES_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isNode);
      }
    }
  } catch {
    // fall through to an empty list
  }
  return [];
}

export function saveNodes(nodes: readonly SavedNode[]): void {
  try {
    localStorage.setItem(NODES_KEY, JSON.stringify(nodes));
  } catch {
    // localStorage unavailable; the list is session-only
  }
}

/**
 * The saved list, seeded with the current connection the first time so an
 * existing install keeps the daemon it was already using.
 */
export function initialNodes(current: Endpoint): readonly SavedNode[] {
  const nodes = loadNodes();
  if (nodes.length > 0) {
    return nodes;
  }
  return [{ id: newNodeId(), name: current.host, ...current, token: loadDeviceToken() }];
}

/** Adds a node, replacing any saved node with the same endpoint. */
export function upsertNode(nodes: readonly SavedNode[], node: SavedNode): readonly SavedNode[] {
  const others = nodes.filter((other) => !sameEndpoint(nodeEndpoint(other), nodeEndpoint(node)));
  return [...others, node];
}

/**
 * `randomUUID` exists only in a secure context; the web client is also served
 * over plain http on the LAN, where `getRandomValues` still works.
 */
export function newNodeId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Makes `node` the active credential; the caller then points the client at its endpoint. */
export function activateNodeToken(node: SavedNode): void {
  saveDeviceToken(node.token);
}

export type ProbeResult =
  | { readonly ok: true; readonly grants: readonly string[]; readonly version: string }
  | { readonly ok: false; readonly error: string };

/** Opens a throwaway connection and runs the handshake, without touching the main client. */
export function probeNode(endpoint: Endpoint, token: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket;
    const finish = (result: ProbeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      ws.close();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ ok: false, error: "timed out" });
    }, PROBE_TIMEOUT_MS);
    try {
      ws = new WebSocket(`ws://${endpoint.host}:${endpoint.port}/ws`);
    } catch {
      clearTimeout(timer);
      resolve({ ok: false, error: "invalid address" });
      return;
    }
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          req_id: "probe",
          protocol_version: PROTOCOL_VERSION,
          token,
          client: CLIENT_ID,
        }),
      );
    });
    ws.addEventListener("message", (event: MessageEvent) => {
      finish(parseHello(event.data));
    });
    ws.addEventListener("error", () => {
      finish({ ok: false, error: "unreachable" });
    });
  });
}

function parseHello(data: unknown): ProbeResult {
  try {
    const reply: unknown = typeof data === "string" ? JSON.parse(data) : null;
    if (isRecord(reply)) {
      const record = reply;
      if (record["type"] === "hello_ok") {
        const grants = Array.isArray(record["grants"])
          ? record["grants"].filter((grant): grant is string => typeof grant === "string")
          : [];
        const version =
          typeof record["server_version"] === "string" ? record["server_version"] : "";
        return { ok: true, grants, version };
      }
      if (typeof record["code"] === "string") {
        return { ok: false, error: record["code"] };
      }
    }
  } catch {
    // fall through
  }
  return { ok: false, error: "unexpected reply" };
}
