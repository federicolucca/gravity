import { ArrowDownLeft, ArrowUpRight, ChevronRight, Paperclip } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import type { ChatItem } from "../../protocol/entities";
import Markdown from "../control/Markdown";
import { baseName, splitAttachments } from "./uploads";

interface ChatItemViewProps {
  readonly item: ChatItem;
  readonly botName: string;
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
          {steps.map((step, index) => (
            <li key={index}>
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
  );
}

export default function ChatItemView({ item, botName }: ChatItemViewProps): ReactElement {
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
        <div className="chat-row chat-row-bot" aria-label={`${botName} said`}>
          <div className="chat-bubble chat-bubble-bot">
            <Markdown>{item.text ?? ""}</Markdown>
          </div>
        </div>
      );
  }
}
