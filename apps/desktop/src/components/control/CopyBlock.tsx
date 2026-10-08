import { Check, Copy } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

/** How long the button shows it copied. */
const COPIED_MS = 1500;

/**
 * The async clipboard exists only in a secure context, and the web client is
 * often served over plain http on the LAN or Tailscale, so fall back to the
 * selection-based copy there.
 */
async function writeClipboard(text: string): Promise<void> {
  if (window.isSecureContext && "clipboard" in navigator) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  // oxlint-disable-next-line typescript/no-deprecated -- the only copy path outside a secure context
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) {
    throw new Error("copy refused");
  }
}

/** A code block with a copy button, so a prompt meant for pasting is one click. */
export default function CopyBlock({ children }: { readonly children?: ReactNode }): ReactElement {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const text = preRef.current?.textContent ?? "";
    try {
      await writeClipboard(text.replace(/\n$/, ""));
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, COPIED_MS);
    } catch {
      // Nothing could copy: the text can still be selected by hand.
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
