import { ArrowDownLeft, ArrowUpRight, ChevronRight, Paperclip, User } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import type { Bot, ChatItem } from "../../protocol/entities";
import BotAvatar from "../BotAvatar";
import Markdown from "../control/Markdown";
import FileDownloads from "./FileDownloads";
import Reaction from "./Reaction";
import { baseName, splitAttachments } from "./uploads";

interface ChatItemViewProps {
  readonly item: ChatItem;
  readonly botName: string;
  /** Who wrote a bot reply, for the small avatar beside it. */
  readonly bot?: Pick<Bot, "id" | "name" | "avatar">;
  readonly onDownload: (path: string) => Promise<void>;
  /** The owner's emoji on this reply; only bot replies take one. */
  readonly reaction?: string;
  /** Absent where reactions are not offered. */
  readonly onReact?: (emoji: string | null) => void;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** A folded run of tool calls: one quiet line that opens into the list. */
function Steps({ item }: { readonly item: ChatItem }): ReactElement {
  const [open, setOpen] = useState(false);
  const steps = item.steps ?? [];
  return (
    <div className={`chat-steps${open ? " chat-steps-open" : ""}`}>
      <button
        type="button"
        className="chat-steps-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
        Details · {plural(steps.length, "step")}
      </button>
      {open ? (
        <ol className="chat-steps-list">
          {steps.map((step, n) => (
            <li key={`${n + 1}:${step.tool}`}>
              <span className="chat-step-tool">{step.tool}</span>
              {step.detail === "" ? null : <span className="chat-step-detail">{step.detail}</span>}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Bus traffic: a centred note, with the body one click away. */
function BusNote({ item }: { readonly item: ChatItem }): ReactElement {
  const [open, setOpen] = useState(false);
  const outgoing = item.kind === "bus_out";
  const Icon = outgoing ? ArrowUpRight : ArrowDownLeft;
  return (
    <div className="chat-bus">
      <button
        type="button"
        className="chat-bus-toggle"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <Icon size={13} strokeWidth={2} aria-hidden="true" />
        {outgoing ? "Messaged" : "Message from"} <strong>{item.peer}</strong>
      </button>
      {open && item.text !== undefined ? (
        <div className="chat-bus-body">
          <Markdown>{item.text}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

/** The owner's prompt; uploaded files show as chips above the bubble. */
function UserMessage({ text }: { readonly text: string }): ReactElement {
  const { body, files } = splitAttachments(text);
  return (
    <div className="chat-line chat-line-user">
      <div className="chat-row chat-row-user chat-row-stack">
        {files.length > 0 ? (
          <ul className="chat-files">
            {files.map((path) => (
              <li key={path} className="chat-file" title={path}>
                <Paperclip size={13} strokeWidth={2} aria-hidden="true" />
                <span>{baseName(path)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {body !== "" ? <div className="chat-bubble chat-bubble-user">{body}</div> : null}
      </div>
      <span className="chat-avatar chat-avatar-me" aria-hidden="true">
        <User size={13} strokeWidth={2.25} />
      </span>
    </div>
  );
}

export default function ChatItemView({
  item,
  botName,
  bot,
  onDownload,
  reaction,
  onReact,
}: ChatItemViewProps): ReactElement {
  switch (item.kind) {
    case "steps":
      return <Steps item={item} />;
    case "bus_in":
    case "bus_out":
      return <BusNote item={item} />;
    case "user":
      return <UserMessage text={item.text ?? ""} />;
    case "bot":
      return (
        <div className="chat-line">
          {bot === undefined ? null : (
            <span className="chat-avatar" aria-hidden="true">
              <BotAvatar avatar={bot.avatar} name={bot.name} id={bot.id} size="sm" />
            </span>
          )}
          <div className="chat-row chat-row-bot chat-row-stack-bot" aria-label={`${botName} said`}>
            <div className="chat-bubble chat-bubble-bot">
              <Markdown>{item.text ?? ""}</Markdown>
            </div>
            <FileDownloads text={item.text ?? ""} onDownload={onDownload} />
            {onReact === undefined ? null : <Reaction emoji={reaction} onReact={onReact} />}
          </div>
        </div>
      );
  }
}
