/** A gap this long between two items gets a centred timestamp. */
const GAP_MS = 20 * 60 * 1000;

function parse(at: string | undefined): number {
  if (at === undefined) {
    return Number.NaN;
  }
  return Date.parse(at);
}

/** True when `at` should be preceded by a timestamp line. */
export function needsTimeGap(previous: string | undefined, at: string): boolean {
  const current = parse(at);
  if (Number.isNaN(current)) {
    return false;
  }
  const before = parse(previous);
  return Number.isNaN(before) || current - before >= GAP_MS;
}

/** "Today 11:35", "Yesterday 09:02" or "8 Oct 11:35". */
export function dayLabel(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (date.getTime() >= startOfToday) {
    return `Today ${time}`;
  }
  if (date.getTime() >= startOfToday - day) {
    return `Yesterday ${time}`;
  }
  const label = date.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${label} ${time}`;
}
