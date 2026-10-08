import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { Bot, ChatItem } from "../../protocol/entities";
import ChatComposer from "./ChatComposer";
import ChatItemView from "./ChatItemView";
import { dayLabel, needsTimeGap } from "./chatTime";

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

  const load = useCallback(async (): Promise<void> => {
    try {
      const reply = await client.request({ type: "get_chat", bot_id: botId }, "chat");
      setItems(reply.items);
    } catch {
      setItems((current) => current ?? []);
    }
  }, [client, botId]);

  useEffect(() => {
    setItems(null);
    pinnedRef.current = true;
    void load();
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
    return () => {
      offActivity();
      offState();
    };
  }, [client, botId, load]);

  useEffect(() => {
    if (!working) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void load();
    }, WORKING_POLL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [working, load]);

  // Follow new items only while the reader sits at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null && pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (el !== null) {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    }
  };

  const send = (text: string): void => {
    pinnedRef.current = true;
    // Bracketed paste keeps a multi-line prompt as one message; the Enter
    // after it is what submits, exactly as when the owner types it.
    client.fire({ type: "input", bot_id: botId, data: `\u001b[200~${text}\u001b[201~` });
    window.setTimeout(() => {
      client.fire({ type: "input", bot_id: botId, data: "\r" });
    }, 120);
  };

  return (
    <div className="chat-pane">
      <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="chat-column">
          {items === null ? <p className="chat-empty">Loading…</p> : null}
          {items !== null && items.length === 0 ? (
            <p className="chat-empty">No conversation yet.</p>
          ) : null}
          {(items ?? []).map((item, index) => {
            const previous = index > 0 ? items?.[index - 1] : undefined;
            return (
              <div key={`${item.at}-${index}`}>
                {needsTimeGap(previous?.at, item.at) ? (
                  <div className="chat-time">{dayLabel(item.at)}</div>
                ) : null}
                <ChatItemView item={item} botName={bot.name} />
              </div>
            );
          })}
          {working ? <div className="chat-typing" aria-label={`${bot.name} is working`} /> : null}
        </div>
      </div>
      <ChatComposer botName={bot.name} disabled={!canWrite} onSend={send} />
    </div>
  );
}
