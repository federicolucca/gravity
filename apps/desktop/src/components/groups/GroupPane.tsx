import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { isStopped } from "../../app/bots";
import type { DaemonApi } from "../../protocol/api";
import type { Bot, BotGroup, ChatItem } from "../../protocol/entities";
import ChatComposer from "../chat/ChatComposer";
import ChatItemView from "../chat/ChatItemView";
import { dayLabel, needsTimeGap } from "../chat/chatTime";
import { downloadFile } from "../chat/downloads";
import { sendPrompt } from "../chat/send";
import { promptWithAttachments, uploadFile } from "../chat/uploads";
import { groupPrompt, mergeThreads, recipientsFor } from "./groupChat";
import type { GroupItem } from "./groupChat";

interface GroupPaneProps {
  readonly client: DaemonApi;
  readonly group: BotGroup;
  readonly members: readonly Bot[];
  readonly canControl: boolean;
}

const WORKING_POLL_MS = 2500;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A group thread: every member's replies to the owner's group prompts, merged
 * in time order. A message goes to the members it @mentions, or to all.
 */
export default function GroupPane({
  client,
  group,
  members,
  canControl,
}: GroupPaneProps): ReactElement {
  const [thread, setThread] = useState<readonly GroupItem[] | null>(null);
  const [pending, setPending] = useState<GroupItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const reloadRef = useRef<(() => void) | null>(null);
  const working = members.filter((bot) => bot.state === "working");
  const anyWorking = working.length > 0;
  const memberKey = members.map((bot) => bot.id).join(",");

  useEffect(() => {
    let alive = true;
    const ids = new Set(memberKey.split(","));
    const load = async (): Promise<void> => {
      const chats = await Promise.all(
        members.map(async (bot) => {
          try {
            const reply = await client.request({ type: "get_chat", bot_id: bot.id }, "chat");
            return { bot, items: reply.items };
          } catch {
            return { bot, items: [] as readonly ChatItem[] };
          }
        }),
      );
      if (alive) {
        setThread(mergeThreads(group, chats));
      }
    };
    void load();
    reloadRef.current = () => {
      void load();
    };
    const offActivity = client.on("activity_update", (push) => {
      if (ids.has(push.activity.bot_id)) {
        void load();
      }
    });
    const offState = client.on("bot_state", (push) => {
      if (ids.has(push.bot_id)) {
        void load();
      }
    });
    const timer = anyWorking
      ? window.setInterval(() => {
          void load();
        }, WORKING_POLL_MS)
      : undefined;
    return () => {
      alive = false;
      reloadRef.current = null;
      offActivity();
      offState();
      window.clearInterval(timer);
    };
    // `members` is keyed by `memberKey`; a new array with the same bots is the same thread.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [client, group, memberKey, anyWorking]);

  const landed =
    pending !== null &&
    (thread ?? []).some((entry) => entry.bot === undefined && entry.item.at >= pending.item.at);
  const shown = pending === null || landed ? thread : [...(thread ?? []), pending];

  useEffect(() => {
    const el = scrollRef.current;
    if ((thread !== null || pending !== null) && el !== null && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thread, pending]);

  const send = async (text: string, files: readonly File[]): Promise<void> => {
    setError(null);
    const recipients = recipientsFor(text, members);
    const live = recipients.filter((bot) => !isStopped(bot));
    if (live.length === 0) {
      setError("None of the addressed bots is running.");
      throw new Error("no running recipient");
    }
    let uploads: (readonly string[])[];
    try {
      // Each bot reads uploads only from its own folder, so every recipient gets a copy.
      uploads = await Promise.all(
        live.map((bot) => Promise.all(files.map((file) => uploadFile(client, bot.id, file)))),
      );
    } catch (failure) {
      setError(`Upload failed: ${errorText(failure)}`);
      throw failure;
    }
    pinnedRef.current = true;
    setPending({
      item: {
        kind: "user",
        at: new Date(Date.now() - 5000).toISOString(),
        text: promptWithAttachments(text, uploads[0] ?? []),
      },
    });
    live.forEach((bot, index) => {
      const body = promptWithAttachments(text, uploads[index] ?? []);
      sendPrompt(client, bot.id, groupPrompt(group, members, live, body));
    });
    const skipped = recipients.filter((bot) => isStopped(bot));
    if (skipped.length > 0) {
      setError(`Not sent to ${skipped.map((bot) => bot.name).join(", ")}: not running.`);
    }
    for (const delay of [1000, 3000]) {
      window.setTimeout(() => {
        reloadRef.current?.();
      }, delay);
    }
  };

  const download = async (bot: Bot, path: string): Promise<void> => {
    setError(null);
    try {
      await downloadFile(client, bot.id, path);
    } catch (failure) {
      setError(`Download failed: ${errorText(failure)}`);
    }
  };

  return (
    <div className="chat-pane">
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (el !== null) {
            pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }
        }}
      >
        <div className="chat-column">
          {shown === null ? <p className="chat-empty">Loading…</p> : null}
          {shown !== null && shown.length === 0 ? (
            <p className="chat-empty">
              No messages yet. A message goes to everyone, or only to the @mentioned bots.
            </p>
          ) : null}
          {(shown ?? []).map((entry, index) => {
            const previous = index > 0 ? shown?.[index - 1] : undefined;
            const { item, bot } = entry;
            const speakerChanged = bot !== undefined && previous?.bot?.id !== bot.id;
            return (
              <div key={`${item.at}-${bot?.id ?? "owner"}-${item.text?.length ?? 0}`}>
                {needsTimeGap(previous?.item.at, item.at) ? (
                  <div className="chat-time">{dayLabel(item.at)}</div>
                ) : null}
                {speakerChanged ? <div className="chat-speaker">{bot.name}</div> : null}
                <ChatItemView
                  item={item}
                  botName={bot?.name ?? "You"}
                  bot={bot}
                  onDownload={(path) =>
                    bot === undefined ? Promise.resolve() : download(bot, path)
                  }
                />
              </div>
            );
          })}
          {anyWorking ? (
            <div className="chat-working-list">
              <div className="chat-typing" aria-hidden="true" />
              <span>{working.map((bot) => bot.name).join(", ")} working…</span>
            </div>
          ) : null}
        </div>
      </div>
      {error !== null ? <p className="chat-error">{error}</p> : null}
      <ChatComposer botName={group.name} disabled={!canControl} onSend={send} />
    </div>
  );
}
