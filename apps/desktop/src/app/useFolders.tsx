import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import FolderNameDialog from "../components/sidebar/FolderNameDialog";
import type { DaemonApi } from "../protocol/api";
import type { RequestBody } from "../protocol/requests";
import type { SidebarFolder } from "../protocol/entities";
import type { AddToast } from "./useToasts";

export interface FoldersApi {
  readonly folders: readonly SidebarFolder[];
  readonly openNew: (projectId: string) => void;
  readonly openRename: (folder: SidebarFolder) => void;
  readonly remove: (folderId: string) => Promise<void>;
  /** Moves a row (`bot:<id>` / `group:<id>`) into a folder, or out of any (`null`). */
  readonly place: (item: string, folderId: string | null) => Promise<void>;
  /** The name dialog while one is open. */
  readonly dialog: ReactElement | null;
}

type Draft =
  | { readonly projectId: string; readonly folder?: undefined }
  | { readonly projectId: string; readonly folder: SidebarFolder };

/** Sidebar folders: the list the daemon keeps, and the dialog that names them. */
export function useFolders(client: DaemonApi, connected: boolean, addToast: AddToast): FoldersApi {
  const [folders, setFolders] = useState<readonly SidebarFolder[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!connected) {
      return;
    }
    let alive = true;
    client
      .request({ type: "list_folders" }, "folders")
      .then((reply) => {
        if (alive) {
          setFolders(reply.folders);
        }
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, connected]);

  const openNew = useCallback((projectId: string): void => {
    setDraft({ projectId });
  }, []);
  const openRename = useCallback((folder: SidebarFolder): void => {
    setDraft({ projectId: folder.project_id, folder });
  }, []);
  const cancel = useCallback((): void => {
    setDraft(null);
  }, []);

  const run = useCallback(
    async (request: RequestBody, failure: string): Promise<void> => {
      try {
        const reply = await client.request(request, "folders");
        setFolders(reply.folders);
      } catch (error) {
        addToast("error", failure, error instanceof Error ? error.message : String(error));
      }
    },
    [addToast, client],
  );

  const remove = useCallback(
    (folderId: string) => run({ type: "delete_folder", folder_id: folderId }, "Folder not deleted"),
    [run],
  );
  const place = useCallback(
    (item: string, folderId: string | null) =>
      run(
        folderId === null
          ? { type: "place_in_folder", item }
          : { type: "place_in_folder", item, folder_id: folderId },
        "Row not moved",
      ),
    [run],
  );

  const save = async (name: string): Promise<void> => {
    if (draft === null) {
      return;
    }
    const reply = await client.request(
      draft.folder === undefined
        ? { type: "save_folder", name, project_id: draft.projectId }
        : { type: "save_folder", folder_id: draft.folder.id, name, project_id: draft.projectId },
      "folders",
    );
    setFolders(reply.folders);
    setDraft(null);
  };

  const dialog =
    draft === null ? null : (
      <FolderNameDialog
        title={draft.folder === undefined ? "New folder" : "Rename folder"}
        initial={draft.folder?.name ?? ""}
        onSave={save}
        onCancel={cancel}
      />
    );

  return { folders, openNew, openRename, remove, place, dialog };
}
