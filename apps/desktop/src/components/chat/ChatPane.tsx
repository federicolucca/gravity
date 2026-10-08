import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { Bot, ChatItem } from "../../protocol/entities";
import ChatComposer from "./ChatComposer";
import ChatItemView from "./ChatItemView";
import { dayLabel, needsTimeGap } from "./chatTime";
import { downloadFile } from "./downloads";
import { sendPrompt } from "./send";
import { promptWithAttachments, uploadFile } from "./uploads";

interface ChatPaneProps {
  readonly client: DaemonApi;
  readonly bot: Bot;
  readonly canWrite: boolean;
}

/** While the bot works, re-read this often so its steps show up as they happen. */
const WORKING_POLL_MS = 2500;

/**
 * A bot's conversation as a dialogue: prompts and replies as bubbles, bus
 * traffic as one-line notes, and the work in between folded into "details".
 * The terminal tab still shows everything; this is the readable view.
 */
export default function ChatPane({ client, bot, canWrite }: ChatPaneProps): ReactElement {
  const [items, setItems] = useState<readonly ChatItem[] | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const botId = bot.id;
  const working = bot.state === "working";

  // Re-reads on demand: after a send, before any push says so.
  const reloadRef = useRef<(() => void) | null>(null);
  // The owner's message, shown until the transcript carries it.
  const [pending, setPending] = useState<ChatItem | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const reply = await client.request({ type: "get_chat", bot_id: botId }, "chat");
        if (alive) {
          setItems(reply.items);
        }
      } catch {
        if (alive) {
          setItems((current) => current ?? []);
        }
      }
    };
    void load();
    reloadRef.current = () => {
      void load();
    };
    const offActivity = client.on("activity_update", (push) => {
      if (push.activity.bot_id === botId) {
        void load();
      }
    });
    const offState = client.on("bot_state", (push) => {
      if (push.bot_id === botId) {
        void load();
      }
    });
    const timer = working
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
  }, [client, botId, working]);

  // Any owner prompt newer than the pending one means the transcript caught up.
  const landed =
    pending !== null && (items ?? []).some((item) => item.kind === "user" && item.at >= pending.at);
  const shown = pending === null || landed ? items : [...(items ?? []), pending];

  // Follow new items only while the reader sits at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if ((items !== null || pending !== null) && el !== null && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items, pending]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el !== null) {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    }
  };

  const [sendError, setSendError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    let alive = true;
    client
      .request({ type: "list_reactions", bot_id: botId }, "reactions")
      .then((reply) => {
        if (alive) {
          setReactions(reply.reactions);
        }
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, botId]);

  const react = async (key: string, emoji: string | null): Promise<void> => {
    const previous = reactions;
    const next = { ...reactions };
    if (emoji === null) {
      delete next[key];
    } else {
      next[key] = emoji;
    }
    setReactions(next);
    try {
      const reply = await client.request(
        emoji === null
          ? { type: "set_reaction", bot_id: botId, key }
          : { type: "set_reaction", bot_id: botId, key, emoji },
        "reactions",
      );
      setReactions(reply.reactions);
    } catch (error) {
      setReactions(previous);
      setSendError(`Reaction not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const download = async (path: string): Promise<void> => {
    setSendError(null);
    try {
      await downloadFile(client, botId, path);
    } catch (error) {
      setSendError(`Download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const send = async (text: string, files: readonly File[]): Promise<void> => {
    setSendError(null);
    let paths: string[];
    try {
      paths = await Promise.all(files.map((file) => uploadFile(client, botId, file)));
    } catch (error) {
      setSendError(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    pinnedRef.current = true;
    const prompt = promptWithAttachments(text, paths);
    // Back-dated a little so a transcript clock a few seconds behind still counts.
    setPending({ kind: "user", at: new Date(Date.now() - 5000).toISOString(), text: prompt });
    sendPrompt(client, botId, prompt);
    for (const delay of [1000, 3000]) {
      window.setTimeout(() => {
        reloadRef.current?.();
      }, delay);
    }
  };

  return (
    <div className="chat-pane">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-column">
          {shown === null ? <p className="chat-empty">Loading…</p> : null}
          {shown !== null && shown.length === 0 ? (
            <p className="chat-empty">No conversation yet.</p>
          ) : null}
          {(shown ?? []).map((item, index) => {
            const previous = index > 0 ? shown?.[index - 1] : undefined;
            return (
              <div key={`${item.at}-${item.kind}-${item.text?.length ?? item.steps?.length ?? 0}`}>
                {needsTimeGap(previous?.at, item.at) ? (
                  <div className="chat-time">{dayLabel(item.at)}</div>
                ) : null}
                <ChatItemView
                  item={item}
                  botName={bot.name}
                  bot={bot}
                  onDownload={download}
                  reaction={reactions[item.at]}
                  onReact={
                    item.kind === "bot" && canWrite
                      ? (emoji) => {
                          void react(item.at, emoji);
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}
          {working ? <div className="chat-typing" aria-label={`${bot.name} is working`} /> : null}
        </div>
      </div>
      {sendError !== null ? <p className="chat-error">{sendError}</p> : null}
      <ChatComposer botName={bot.name} disabled={!canWrite} onSend={send} />
    </div>
  );
}
