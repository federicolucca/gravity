import type { Bot, BotGroup, ChatItem } from "../../protocol/entities";

/** One entry of a group thread: an item from one member's transcript. */
export interface GroupItem {
  readonly item: ChatItem;
  /** The member that said it; absent for the owner's own prompts. */
  readonly bot?: Bot;
}

/** Owner prompts this close together with the same text are one group message. */
const SAME_PROMPT_MS = 120_000;

/** The marker that opens every prompt sent through `group`; it survives renames. */
function groupMarker(group: BotGroup): string {
  return `#${group.id.slice(0, 8)}`;
}

function names(bots: readonly Bot[]): string {
  return bots.map((bot) => bot.name).join(", ");
}

/**
 * The prompt one member receives. Its first line says who else is in the
 * group, who was addressed, and that the others do not see the reply, so a
 * member coordinates over the bus instead of assuming a shared room.
 */
export function groupPrompt(
  group: BotGroup,
  members: readonly Bot[],
  recipients: readonly Bot[],
  body: string,
): string {
  const header =
    `[Group "${group.name}" ${groupMarker(group)} · to ${names(recipients)} · ` +
    `members ${names(members)}. The owner reads your reply here; the other members ` +
    `do not, so use send_message to coordinate with them.]`;
  return `${header}\n${body}`;
}

/** The owner's text of a group prompt, or null when `text` was not sent to `group`. */
function groupBody(group: BotGroup, text: string): string | null {
  const newline = text.indexOf("\n");
  const first = newline === -1 ? text : text.slice(0, newline);
  if (!first.startsWith("[Group ") || !first.includes(groupMarker(group))) {
    return null;
  }
  return newline === -1 ? "" : text.slice(newline + 1);
}

/**
 * Who a message goes to: the members it @mentions, or everyone when it
 * mentions none. Longer names are matched first so "@Master of Ubuntu" is not
 * also read as a shorter name it contains.
 */
export function recipientsFor(text: string, members: readonly Bot[]): readonly Bot[] {
  let rest = text.toLowerCase();
  const named: Bot[] = [];
  for (const bot of members.toSorted((a, b) => b.name.length - a.name.length)) {
    const tag = `@${bot.name.toLowerCase()}`;
    if (rest.includes(tag)) {
      named.push(bot);
      rest = rest.replaceAll(tag, " ");
    }
  }
  return named.length === 0 ? members : members.filter((bot) => named.includes(bot));
}

/**
 * One member's share of the group thread: the owner's group prompts and the
 * replies that followed them, up to the next prompt from anywhere else.
 */
function memberThread(group: BotGroup, bot: Bot, items: readonly ChatItem[]): GroupItem[] {
  const thread: GroupItem[] = [];
  let inGroup = false;
  for (const item of items) {
    if (item.kind === "user") {
      const body = groupBody(group, item.text ?? "");
      inGroup = body !== null;
      if (body !== null) {
        thread.push({ item: { ...item, text: body } });
      }
    } else if (inGroup && item.kind === "bot") {
      thread.push({ item, bot });
    }
  }
  return thread;
}

/** Every member's thread in time order, with the owner's fan-out shown once. */
export function mergeThreads(
  group: BotGroup,
  chats: ReadonlyArray<{ readonly bot: Bot; readonly items: readonly ChatItem[] }>,
): readonly GroupItem[] {
  const all = chats
    .flatMap(({ bot, items }) => memberThread(group, bot, items))
    .toSorted((a, b) => Date.parse(a.item.at) - Date.parse(b.item.at));
  const merged: GroupItem[] = [];
  for (const entry of all) {
    const duplicate =
      entry.bot === undefined &&
      merged.some(
        (seen) =>
          seen.bot === undefined &&
          seen.item.text === entry.item.text &&
          Math.abs(Date.parse(seen.item.at) - Date.parse(entry.item.at)) < SAME_PROMPT_MS,
      );
    if (!duplicate) {
      merged.push(entry);
    }
  }
  return merged;
}
