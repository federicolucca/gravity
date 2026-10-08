import type { DaemonApi } from "../../protocol/api";

/** Raw bytes per chunk: 384 KiB is 512 KiB of base64, well under the 1 MiB frame cap. */
const CHUNK_BYTES = 384 * 1024;

/** The prefix a prompt uses to name an uploaded file; the chat view renders it as a chip. */
export const ATTACHED_PREFIX = "Attached file: ";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Uploads one file to the bot's upload directory; resolves to its path on the daemon's machine. */
export async function uploadFile(client: DaemonApi, botId: string, file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let stored: string | undefined;
  let path = "";
  let offset = 0;
  do {
    const chunk = toBase64(bytes.subarray(offset, offset + CHUNK_BYTES));
    const reply = await client.request(
      stored === undefined
        ? { type: "upload_file", bot_id: botId, name: file.name, data: chunk }
        : { type: "upload_file", bot_id: botId, name: file.name, data: chunk, file: stored },
      "uploaded",
    );
    stored = reply.file;
    path = reply.path;
    offset += CHUNK_BYTES;
  } while (offset < bytes.length);
  return path;
}

/** The prompt sent for a message plus its uploaded files. */
export function promptWithAttachments(text: string, paths: readonly string[]): string {
  const lines = paths.map((path) => `${ATTACHED_PREFIX}${path}`);
  return [text, ...lines].filter((part) => part !== "").join("\n");
}

/** Splits a user prompt back into its text and the attached file paths. */
export function splitAttachments(text: string): { readonly body: string; readonly files: readonly string[] } {
  const files: string[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith(ATTACHED_PREFIX)) {
      files.push(line.slice(ATTACHED_PREFIX.length).trim());
    } else {
      kept.push(line);
    }
  }
  return { body: kept.join("\n").trim(), files };
}

/** The last path segment, for display. */
export function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  // Uploads are stored as `<timestamp>-<name>`.
  return name.replace(/^\d{8}-\d{9}-/, "");
}
