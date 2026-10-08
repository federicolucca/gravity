import { ArrowUp, Paperclip, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactElement } from "react";

interface ChatComposerProps {
  readonly botName: string;
  readonly disabled: boolean;
  /** Resolves once the message (and its files) went out; rejects to keep the draft. */
  readonly onSend: (text: string, files: readonly File[]) => Promise<void>;
}

/** Enter sends, Shift+Enter breaks the line; files come from "+", paste or drop. */
export default function ChatComposer({
  botName,
  disabled,
  onSend,
}: ChatComposerProps): ReactElement {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<readonly File[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  const text = draft.trim();
  const blocked = disabled || sending;
  const empty = text === "" && files.length === 0;

  const addFiles = (list: FileList | null): void => {
    if (list !== null && list.length > 0) {
      const added = Array.from(list);
      setFiles((current) => [...current, ...added.filter((file) => !current.includes(file))]);
    }
  };

  const submit = async (): Promise<void> => {
    if (blocked || empty) {
      return;
    }
    setSending(true);
    try {
      await onSend(text, files);
      setDraft("");
      setFiles([]);
    } catch {
      // The pane reports the failure; the draft stays for a retry.
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      addFiles(event.clipboardData.files);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (!blocked) {
      addFiles(event.dataTransfer.files);
    }
  };

  return (
    <div
      className={`chat-composer${dragging ? " chat-composer-drop" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => {
        setDragging(false);
      }}
      onDrop={onDrop}
    >
      {files.length > 0 ? (
        <ul className="chat-pending">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}`} className="chat-file">
              <Paperclip size={13} strokeWidth={2} aria-hidden="true" />
              <span>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={sending}
                onClick={() => {
                  setFiles((current) => current.filter((other) => other !== file));
                }}
              >
                <X size={12} strokeWidth={2.25} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chat-composer-row">
        <button
          type="button"
          className="chat-attach"
          aria-label="Attach files"
          disabled={blocked}
          onClick={() => {
            pickerRef.current?.click();
          }}
        >
          <Plus size={18} strokeWidth={2} aria-hidden="true" />
        </button>
        <input
          ref={pickerRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
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
          onPaste={onPaste}
        />
        <button
          type="button"
          className="chat-send"
          aria-label="Send"
          disabled={blocked || empty}
          onClick={() => {
            void submit();
          }}
        >
          <ArrowUp size={18} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
