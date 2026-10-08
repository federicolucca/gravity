const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Bytes in the largest unit that keeps the number under 1024. */
export function bytes(value: number): string {
  let n = value;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(n >= 100 || unit === 0 ? 0 : 1)} ${UNITS[unit]}`;
}

/** Seconds as "3d 4h" / "4h 12m" / "12m". */
export function duration(secs: number): string {
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) {
    return `${d}d ${h}h`;
  }
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Meter tone: calm, warm, hot. */
export function level(percent: number, warn = 70, hot = 90): "ok" | "warn" | "hot" {
  if (percent >= hot) {
    return "hot";
  }
  return percent >= warn ? "warn" : "ok";
}
