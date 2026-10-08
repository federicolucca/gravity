import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import GroupDialog from "../components/groups/GroupDialog";
import type { DaemonApi } from "../protocol/api";
import type { Bot, BotGroup } from "../protocol/entities";
import type { Selection } from "./selection";
import type { AddToast } from "./useToasts";

export interface GroupsApi {
  readonly groups: readonly BotGroup[];
  readonly openNew: (projectId: string) => void;
  readonly openEdit: (group: BotGroup) => void;
  readonly remove: (groupId: string) => Promise<void>;
  /** The create/edit dialog while one is open. */
  readonly dialog: ReactElement | null;
}

interface Draft {
  readonly projectId: string;
  readonly group?: BotGroup;
}

/** Group chats: the list the daemon keeps, and the dialog that edits it. */
export function useGroups(
  client: DaemonApi,
  connected: boolean,
  bots: readonly Bot[],
  select: (next: Selection) => void,
  addToast: AddToast,
): GroupsApi {
  const [groups, setGroups] = useState<readonly BotGroup[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!connected) {
      return;
    }
    let alive = true;
    client
      .request({ type: "list_groups" }, "groups")
      .then((reply) => {
        if (alive) {
          setGroups(reply.groups);
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
  const openEdit = useCallback((group: BotGroup): void => {
    setDraft({ projectId: group.project_id, group });
  }, []);
  const cancel = useCallback((): void => {
    setDraft(null);
  }, []);

  const remove = useCallback(
    async (groupId: string): Promise<void> => {
      try {
        await client.request({ type: "delete_group", group_id: groupId }, "group_deleted");
        setGroups((current) => current.filter((group) => group.id !== groupId));
        select({ kind: "none" });
      } catch (error) {
        addToast(
          "error",
          "Group not deleted",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [addToast, client, select],
  );

  const save = async (name: string, botIds: readonly string[]): Promise<void> => {
    if (draft === null) {
      return;
    }
    const reply = await client.request(
      draft.group === undefined
        ? { type: "save_group", name, project_id: draft.projectId, bot_ids: botIds }
        : {
            type: "save_group",
            group_id: draft.group.id,
            name,
            project_id: draft.projectId,
            bot_ids: botIds,
          },
      "group_saved",
    );
    setGroups((current) => [
      ...current.filter((group) => group.id !== reply.group.id),
      reply.group,
    ]);
    setDraft(null);
    select({ kind: "group", groupId: reply.group.id });
  };

  const dialog =
    draft === null ? null : (
      <GroupDialog
        bots={bots.filter((bot) => bot.project_id === draft.projectId)}
        group={draft.group}
        onSave={save}
        onCancel={cancel}
      />
    );

  return { groups, openNew, openEdit, remove, dialog };
}
