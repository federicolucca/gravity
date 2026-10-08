import type { ChatItem } from "../../protocol/entities";

/** A prompt shown before the transcript records it. */
export interface PendingPrompt {
  /** Back-dated a little so a transcript clock a few seconds behind still counts. */
  readonly at: string;
  readonly text: string;
}

/** Long enough to cover a prompt queued behind a long turn. */
const GIVE_UP_MS = 15 * 60_000;

/** Terminals and transcripts disagree on whitespace, never on words. */
function normalize(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

/**
 * The pending prompts the transcript has not caught up with yet. Each one is
 * matched to its own owner message by text, so a second prompt sent while the
 * first is still queued stays visible until it lands too.
 */
export function unlanded(
  pending: readonly PendingPrompt[],
  items: readonly ChatItem[],
  now = Date.now(),
): PendingPrompt[] {
  const used = new Set<number>();
  return pending.filter((prompt) => {
    if (now - Date.parse(prompt.at) > GIVE_UP_MS) {
      return false;
    }
    const text = normalize(prompt.text);
    const index = items.findIndex(
      (item, i) =>
        !used.has(i) &&
        item.kind === "user" &&
        item.at >= prompt.at &&
        normalize(item.text ?? "") === text,
    );
    if (index === -1) {
      return true;
    }
    used.add(index);
    return false;
  });
}
