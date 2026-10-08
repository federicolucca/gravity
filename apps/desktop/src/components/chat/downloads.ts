import type { DaemonApi } from "../../protocol/api";

/** An absolute path with a file extension, standing alone or in backticks/quotes. */
const PATH_RE = /(?:^|[\s`'"(])(\/(?:[\w.@+-]+\/)+[\w.@+-]*\.[A-Za-z0-9]{1,8})(?=$|[\s`'"),:;]|\.(?:$|\s))/g;

/** Most file chips one reply offers. */
const MAX_FILES = 8;

/** The file paths a bot's reply names, in order, without duplicates. */
export function filePaths(text: string): readonly string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH_RE)) {
    const path = match[1];
    if (path !== undefined) {
      found.add(path);
    }
  }
  return [...found].slice(0, MAX_FILES);
}

function fromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Fetches a file from the bot's folders in chunks and hands it to the browser to save. */
export async function downloadFile(client: DaemonApi, botId: string, path: string): Promise<void> {
  // Chunks must arrive in order, so each one waits for the previous reply.
  const fetchFrom = async (
    offset: number,
    parts: readonly Uint8Array<ArrayBuffer>[],
  ): Promise<readonly Uint8Array<ArrayBuffer>[]> => {
    const reply = await client.request(
      { type: "download_file", bot_id: botId, path, offset },
      "downloaded",
    );
    const next = [...parts, fromBase64(reply.data)];
    return reply.done ? next : fetchFrom(reply.offset, next);
  };
  const parts = await fetchFrom(0, []);
  const url = URL.createObjectURL(new Blob([...parts]));
  const link = document.createElement("a");
  link.href = url;
  link.download = path.split("/").pop() ?? "download";
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
