import { useState } from "react";
import type { ReactElement } from "react";
import {
  activateNodeToken,
  findNode,
  initialNodes,
  newNodeId,
  nodeEndpoint,
  probeNode,
  saveNodes,
  upsertNode,
} from "../../nodes";
import type { ProbeResult, SavedNode } from "../../nodes";
import type { Endpoint } from "../../protocol/connection";

interface NodeSettingsProps {
  readonly endpoint: Endpoint;
  readonly onChangeEndpoint: (endpoint: Endpoint) => void;
}

interface Draft {
  readonly name: string;
  readonly host: string;
  readonly port: string;
  readonly token: string;
}

const EMPTY_DRAFT: Draft = { name: "", host: "", port: "49777", token: "" };

/** The node a draft describes, or null while it is incomplete. */
function draftNode(draft: Draft): SavedNode | null {
  const port = Number.parseInt(draft.port, 10);
  const host = draft.host.trim();
  if (host.length === 0 || !Number.isInteger(port) || port <= 0) {
    return null;
  }
  const name = draft.name.trim();
  return {
    id: newNodeId(),
    name: name.length > 0 ? name : host,
    host,
    port,
    token: draft.token.trim(),
  };
}

function probeLabel(result: ProbeResult): string {
  return result.ok
    ? `OK · daemon ${result.version} · ${result.grants.join(", ")}`
    : `Failed: ${result.error}`;
}

/** Saved daemons this client can switch between, each with its own credential. */
export default function NodeSettings(props: NodeSettingsProps): ReactElement {
  const { endpoint, onChangeEndpoint } = props;
  const [nodes, setNodes] = useState(() => initialNodes(endpoint));
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [probe, setProbe] = useState("");
  const active = findNode(nodes, endpoint);
  const candidate = draftNode(draft);

  const update = (next: readonly SavedNode[]): void => {
    saveNodes(next);
    setNodes(next);
  };

  const connect = (node: SavedNode): void => {
    activateNodeToken(node);
    onChangeEndpoint(nodeEndpoint(node));
  };

  const runProbe = async (node: SavedNode): Promise<void> => {
    setProbe("Testing…");
    setProbe(probeLabel(await probeNode(nodeEndpoint(node), node.token)));
  };

  const edit = (field: keyof Draft, value: string): void => {
    setDraft({ ...draft, [field]: value });
    setProbe("");
  };

  return (
    <>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">Nodes</div>
          <div className="settings-row-help">
            Daemons this app can switch between. Each remote node uses its own device token.
          </div>
        </div>
      </div>
      <table className="runs-table nodes-table">
        <tbody>
          {nodes.map((node) => (
            <tr key={node.id}>
              <td>
                <span className="device-name">{node.name}</span>
                {node.id === active?.id ? <span className="muted"> (connected)</span> : null}
              </td>
              <td className="muted">
                {node.host}:{node.port}
                {node.token.length === 0 ? " · owner token" : " · device token"}
              </td>
              <td className="nodes-actions">
                <button
                  type="button"
                  className="btn btn-small"
                  aria-label={`Switch to ${node.name}`}
                  disabled={node.id === active?.id}
                  onClick={() => {
                    connect(node);
                  }}
                >
                  Switch
                </button>
                <button
                  type="button"
                  className="btn btn-small btn-danger"
                  aria-label={`Remove ${node.name}`}
                  onClick={() => {
                    update(nodes.filter((other) => other.id !== node.id));
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="settings-row settings-row-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (candidate !== null) {
            update(upsertNode(nodes, candidate));
            setDraft(EMPTY_DRAFT);
            setProbe("");
          }
        }}
      >
        <div className="settings-row-text">
          <div className="settings-row-label">Add node</div>
          <div className="settings-row-help">
            Leave the token empty for this machine&apos;s own daemon. {probe}
          </div>
          <div className="settings-inline-fields">
            <input
              aria-label="Node name"
              placeholder="Name"
              value={draft.name}
              onChange={(event) => {
                edit("name", event.target.value);
              }}
            />
            <input
              aria-label="Node host"
              placeholder="Host or IP"
              value={draft.host}
              onChange={(event) => {
                edit("host", event.target.value);
              }}
            />
            <input
              aria-label="Node port"
              placeholder="Port"
              inputMode="numeric"
              className="settings-port"
              value={draft.port}
              onChange={(event) => {
                edit("port", event.target.value);
              }}
            />
          </div>
          <div className="settings-inline-fields">
            <input
              aria-label="Node device token"
              placeholder="Device token"
              type="password"
              autoComplete="off"
              value={draft.token}
              onChange={(event) => {
                edit("token", event.target.value);
              }}
            />
            <button
              type="button"
              className="btn btn-small"
              disabled={candidate === null}
              onClick={() => {
                if (candidate !== null) {
                  void runProbe(candidate);
                }
              }}
            >
              Test
            </button>
            <button
              type="submit"
              className="btn btn-small btn-primary"
              disabled={candidate === null}
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
