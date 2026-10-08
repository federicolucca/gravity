import { Square } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { MachineStats } from "../../protocol/entities";
import { bytes } from "./format";

type Process = MachineStats["processes"][number];

/**
 * The busiest processes, each with a Stop button. Stopping takes two clicks;
 * a process that survives SIGTERM is offered a forced kill on the next try.
 */
export default function ProcessTable({
  client,
  processes,
}: {
  readonly client: DaemonApi;
  readonly processes: readonly Process[];
}): ReactElement {
  const [armed, setArmed] = useState<number | null>(null);
  const [termed, setTermed] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const stop = async (pid: number): Promise<void> => {
    const force = termed.has(pid);
    setArmed(null);
    try {
      await client.request({ type: "stop_process", pid, force }, "process_stopped");
      setTermed((prev) => new Set(prev).add(pid));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  return (
    <>
      <table className="machine-table">
        <tbody>
          {processes.map((proc) => {
            const verb = termed.has(proc.pid) ? "Kill" : "Stop";
            return (
              <tr key={proc.pid}>
                <td title={`pid ${proc.pid}`}>{proc.name}</td>
                <td>{proc.cpu.toFixed(1)}%</td>
                <td>{bytes(proc.rss)}</td>
                <td className="machine-proc-action">
                  <button
                    type="button"
                    className={`btn btn-small${armed === proc.pid ? " btn-danger" : ""}`}
                    aria-label={`${verb} ${proc.name} (pid ${proc.pid})`}
                    onClick={() => {
                      if (armed === proc.pid) {
                        void stop(proc.pid);
                      } else {
                        setArmed(proc.pid);
                      }
                    }}
                    onBlur={() => {
                      setArmed((current) => (current === proc.pid ? null : current));
                    }}
                  >
                    <Square size={10} aria-hidden="true" />
                    {armed === proc.pid ? `${verb}?` : verb}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error === null ? null : <p className="chat-error">{error}</p>}
    </>
  );
}
