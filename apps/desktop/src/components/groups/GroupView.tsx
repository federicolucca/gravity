import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import type { DaemonApi } from "../../protocol/api";
import type { Bot, BotGroup } from "../../protocol/entities";
import BotAvatar from "../BotAvatar";
import ConfirmDialog from "../overlay/ConfirmDialog";
import GroupPane from "./GroupPane";

interface GroupViewProps {
  readonly client: DaemonApi;
  readonly group: BotGroup;
  readonly bots: readonly Bot[];
  readonly canControl: boolean;
  readonly onEdit: (group: BotGroup) => void;
  readonly onDelete: (groupId: string) => Promise<void>;
}

/** A group chat: its members in the header, the merged thread below. */
export default function GroupView({
  client,
  group,
  bots,
  canControl,
  onEdit,
  onDelete,
}: GroupViewProps): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const members = group.bot_ids
    .map((id) => bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => bot !== undefined);

  return (
    <div className="bot-view">
      <header className="view-header" data-tauri-drag-region="deep">
        <div className="view-header-main">
          <h2 className="view-title">{group.name}</h2>
          <ul className="group-members" aria-label="Members">
            {members.map((bot) => (
              <li key={bot.id} title={bot.name}>
                <BotAvatar avatar={bot.avatar} name={bot.name} id={bot.id} size="sm" />
              </li>
            ))}
          </ul>
        </div>
        {canControl ? (
          <div className="view-header-actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Edit group"
              title="Edit group"
              onClick={() => {
                onEdit(group);
              }}
            >
              <Pencil size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Delete group"
              title="Delete group"
              onClick={() => {
                setConfirming(true);
              }}
            >
              <Trash2 size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>
      <div className="bot-view-body">
        <GroupPane
          key={group.id}
          client={client}
          group={group}
          members={members}
          canControl={canControl}
        />
      </div>
      {confirming ? (
        <ConfirmDialog
          title="Delete group"
          body={`Delete "${group.name}"? The bots and their conversations stay.`}
          confirmLabel="Delete group"
          onConfirm={() => {
            setConfirming(false);
            void onDelete(group.id);
          }}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      ) : null}
    </div>
  );
}
