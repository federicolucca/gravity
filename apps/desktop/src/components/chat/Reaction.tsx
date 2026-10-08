import { SmilePlus } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

const CHOICES = ["👍", "❤️", "😂", "🎉", "🙏", "👀", "✅", "❌"];

interface ReactionProps {
  readonly emoji: string | undefined;
  /** `null` clears the reaction. */
  readonly onReact: (emoji: string | null) => void;
}

/** The owner's emoji on a bot reply: a badge, and a small picker to set it. */
export default function Reaction({ emoji, onReact }: ReactionProps): ReactElement {
  const [open, setOpen] = useState(false);
  const pick = (choice: string): void => {
    setOpen(false);
    onReact(choice === emoji ? null : choice);
  };
  return (
    <div className={`chat-reaction${emoji === undefined ? "" : " chat-reaction-set"}`}>
      {emoji === undefined ? null : (
        <button
          type="button"
          className="chat-reaction-badge"
          aria-label={`Reacted ${emoji}; remove`}
          onClick={() => {
            onReact(null);
          }}
        >
          {emoji}
        </button>
      )}
      <button
        type="button"
        className="chat-reaction-add"
        aria-label="React"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        <SmilePlus size={15} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {open ? (
        <div className="chat-reaction-picker" role="menu">
          {CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              role="menuitem"
              className={choice === emoji ? "picked" : undefined}
              onClick={() => {
                pick(choice);
              }}
            >
              {choice}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
