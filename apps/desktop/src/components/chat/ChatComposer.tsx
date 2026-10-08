import { ArrowUp } from "lucide-react";
import { useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";

interface ChatComposerProps {
  readonly botName: string;
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
}

/** Enter sends, Shift+Enter breaks the line. */
export default function ChatComposer({ botName, disabled, onSend }: ChatComposerProps): ReactElement {
  const [draft, setDraft] = useState("");
  const text = draft.trim();

  const submit = (): void => {
    if (disabled || text === "") {
      return;
    }
    onSend(text);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-composer">
      <textarea
        className="chat-input"
        rows={1}
        value={draft}
        disabled={disabled}
        placeholder={disabled ? `${botName} is not running` : `Message ${botName}`}
        aria-label={`Message ${botName}`}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="chat-send"
        aria-label="Send"
        disabled={disabled || text === ""}
        onClick={submit}
      >
        <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  );
}
