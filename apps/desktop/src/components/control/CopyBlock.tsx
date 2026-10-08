import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

/** How long the button shows it copied. */
const COPIED_MS = 1500;

/** A code block with a copy button, so a prompt meant for pasting is one click. */
export default function CopyBlock({ children }: { readonly children?: ReactNode }): ReactElement {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const text = preRef.current?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text.replace(/\n$/, ""));
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, COPIED_MS);
    } catch {
      // No clipboard (an insecure origin): the text can still be selected.
    }
  };

  return (
    <div className="copy-block">
      <pre ref={preRef}>{children}</pre>
      <button
        type="button"
        className="copy-block-button"
        aria-label={copied ? "Copied" : "Copy"}
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          void copy();
        }}
      >
        {copied ? (
          <Check size={14} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Copy size={14} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
