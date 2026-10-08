import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { filePaths } from "./downloads";

interface FileDownloadsProps {
  readonly text: string;
  readonly onDownload: (path: string) => Promise<void>;
}

/** A download button for each file a bot's reply names. */
export default function FileDownloads({
  text,
  onDownload,
}: FileDownloadsProps): ReactElement | null {
  const [busy, setBusy] = useState<string | null>(null);
  const paths = filePaths(text);
  if (paths.length === 0) {
    return null;
  }
  return (
    <ul className="chat-files chat-files-bot">
      {paths.map((path) => (
        <li key={path}>
          <button
            type="button"
            className="chat-file chat-file-download"
            title={`Download ${path}`}
            disabled={busy !== null}
            onClick={() => {
              setBusy(path);
              void onDownload(path).finally(() => {
                setBusy(null);
              });
            }}
          >
            {busy === path ? (
              <LoaderCircle size={13} strokeWidth={2} aria-hidden="true" className="spin" />
            ) : (
              <Download size={13} strokeWidth={2} aria-hidden="true" />
            )}
            <span>{path.split("/").pop()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
