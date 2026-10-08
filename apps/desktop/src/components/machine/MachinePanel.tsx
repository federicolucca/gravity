import { Cpu, HardDrive, MemoryStick, Network, Thermometer, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { MachineStats } from "../../protocol/entities";
import OverlayShell from "../overlay/OverlayShell";
import { bytes, duration, level } from "./format";

interface MachinePanelProps {
  readonly client: DaemonApi;
  readonly onClose: () => void;
}

const REFRESH_MS = 2000;

function Meter({
  percent,
  warn,
  hot,
}: {
  readonly percent: number;
  readonly warn?: number;
  readonly hot?: number;
}): ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`meter meter-${level(clamped, warn, hot)}`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

function Card({
  icon,
  title,
  value,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly value?: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="machine-card">
      <header>
        {icon}
        <h3>{title}</h3>
        {value === undefined ? null : <strong>{value}</strong>}
      </header>
      {children}
    </section>
  );
}

function StatsView({ stats }: { readonly stats: MachineStats }): ReactElement {
  const memUsed = stats.memory.total - stats.memory.available;
  const memPct = (memUsed / Math.max(stats.memory.total, 1)) * 100;
  const swapUsed = stats.swap.total - stats.swap.free;
  return (
    <div className="machine-grid">
      <Card icon={<Cpu size={16} />} title="CPU" value={`${stats.cpu.toFixed(0)}%`}>
        <Meter percent={stats.cpu} />
        <p className="machine-sub">
          {stats.cpu_model} · {stats.cores.length} threads · load{" "}
          {stats.load.map((n) => n.toFixed(2)).join(" / ")}
        </p>
        <div className="machine-cores" aria-label="Per-core usage">
          {stats.cores
            .map((pct, core) => ({ name: `CPU ${core}`, pct }))
            .map(({ name, pct }) => (
              <span
                key={name}
                className={`core core-${level(pct)}`}
                title={`${name}: ${pct.toFixed(0)}%`}
              >
                <span style={{ height: `${Math.max(pct, 2)}%` }} />
              </span>
            ))}
        </div>
      </Card>

      <Card icon={<MemoryStick size={16} />} title="Memory" value={`${memPct.toFixed(0)}%`}>
        <Meter percent={memPct} />
        <p className="machine-sub">
          {bytes(memUsed)} used of {bytes(stats.memory.total)} · {bytes(stats.memory.available)}{" "}
          available
        </p>
        {stats.swap.total > 0 ? (
          <>
            <Meter percent={(swapUsed / stats.swap.total) * 100} warn={50} hot={80} />
            <p className="machine-sub">
              Swap {bytes(swapUsed)} of {bytes(stats.swap.total)}
            </p>
          </>
        ) : null}
      </Card>

      <Card icon={<HardDrive size={16} />} title="Disks">
        {stats.disks.map((disk) => {
          const used = disk.total - disk.free;
          const pct = (used / disk.total) * 100;
          return (
            <div key={disk.device} className="machine-row">
              <div className="machine-row-head">
                <span title={`${disk.device} · ${disk.fs}`}>{disk.mount}</span>
                <span>
                  {bytes(disk.free)} free of {bytes(disk.total)}
                </span>
              </div>
              <Meter percent={pct} warn={80} hot={92} />
            </div>
          );
        })}
      </Card>

      <Card icon={<Thermometer size={16} />} title="Temperatures">
        {stats.temperatures.length === 0 ? <p className="machine-sub">No sensors found.</p> : null}
        {stats.temperatures.map((chip) => (
          <div key={chip.chip} className="machine-row">
            <div className="machine-row-head">
              <span>{chip.chip}</span>
              <span className={`temp temp-${level(chip.max, 70, 85)}`}>
                {chip.max.toFixed(0)} °C
              </span>
            </div>
            <Meter percent={chip.max} warn={70} hot={85} />
          </div>
        ))}
      </Card>

      <Card icon={<Network size={16} />} title="Network">
        <table className="machine-table">
          <tbody>
            {stats.network.map((nic) => (
              <tr key={nic.iface}>
                <td>{nic.iface}</td>
                <td>↓ {bytes(nic.rx_rate)}/s</td>
                <td>↑ {bytes(nic.tx_rate)}/s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card icon={<Cpu size={16} />} title="Top processes">
        <table className="machine-table">
          <tbody>
            {stats.processes.map((proc) => (
              <tr key={proc.pid}>
                <td title={`pid ${proc.pid}`}>{proc.name}</td>
                <td>{proc.cpu.toFixed(1)}%</td>
                <td>{bytes(proc.rss)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** The daemon's machine at a glance, refreshed while open. */
export default function MachinePanel({ client, onClose }: MachinePanelProps): ReactElement {
  const [stats, setStats] = useState<MachineStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async (): Promise<void> => {
      try {
        const reply = await client.request({ type: "machine_stats" }, "machine_stats");
        if (alive) {
          setStats(reply.stats);
          setError(null);
        }
      } catch (failure) {
        if (alive) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }
      if (alive) {
        timer = window.setTimeout(() => {
          void load();
        }, REFRESH_MS);
      }
    };
    void load();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [client, onClose]);

  return (
    <OverlayShell label="Machine" onClose={onClose}>
      <div className="machine-panel">
        <header className="machine-head">
          <div>
            <h2>{stats?.hostname ?? "Machine"}</h2>
            {stats === null ? null : (
              <p>
                {stats.os} · kernel {stats.kernel} · up {duration(stats.uptime_secs)}
              </p>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        {error !== null ? <p className="chat-error">{error}</p> : null}
        {stats === null ? <p className="machine-sub">Loading…</p> : <StatsView stats={stats} />}
      </div>
    </OverlayShell>
  );
}
