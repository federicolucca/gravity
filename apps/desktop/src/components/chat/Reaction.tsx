import type { ReactElement } from "react";

/** A bot's emoji on one of the owner's messages. Read-only: only bots react. */
export default function Reaction({ emoji }: { readonly emoji: string }): ReactElement {
  return (
    <div className="chat-reaction">
      <span className="chat-reaction-badge" role="img" aria-label={`Reacted ${emoji}`}>
        {emoji}
      </span>
    </div>
  );
}
