import { useState } from "react";
import { byRecency, folderSummary, rowKey, withFolders, withGroups } from "./recency";
import type { SidebarRow } from "./recency";
import type { ReactElement } from "react";
import type { Bot, Project } from "../../protocol/entities";
import BotRow from "./BotRow";
import FolderRow, { ROW_DRAG_TYPE } from "./FolderRow";
import GroupRow from "./GroupRow";
import { MoreIcon } from "./icons";
import PinnedBots from "./PinnedBots";
import type { SidebarTreeProps } from "./tree";
import { useProjectMenu } from "./useProjectMenu";

export interface ProjectSectionProps extends SidebarTreeProps {
  readonly project: Project;
  readonly bots: readonly Bot[];
}

/** One project and its collapsible list of bots. */
export default function ProjectSection(props: ProjectSectionProps): ReactElement {
  const { project, bots, selection, canControl, onSelect, pinnedBotIds } = props;
  const [collapsed, setCollapsed] = useState(false);
  const openSettings = (): void => {
    onSelect({ kind: "project", projectId: project.id });
  };
  const menu = useProjectMenu({
    project,
    bots,
    canControl,
    onOpenSettings: openSettings,
    onCreateBot: () => {
      props.onCreateBot(project.id);
    },
    onNewGroup:
      bots.length >= 2
        ? () => {
            props.onNewGroup(project.id);
          }
        : undefined,
    onNewFolder: () => {
      props.onNewFolder(project.id);
    },
    onOpenMachine: props.onOpenMachine,
    onDelete: () => {
      void props.onDeleteProject(project.id);
    },
  });

  const pinnedBots = pinnedBotIds
    .map((id) => bots.find((bot) => bot.id === id))
    .filter((bot): bot is Bot => bot !== undefined);
  const rows = withGroups(
    byRecency(
      bots.filter((bot) => !pinnedBotIds.includes(bot.id)),
      props.activityByBot,
    ),
    props.groups.filter((group) => group.project_id === project.id),
    props.activityByBot,
    props.groupActivity ?? {},
  );
  const entries = withFolders(
    rows,
    props.folders.filter((folder) => folder.project_id === project.id),
    props.activityByBot,
    props.groupActivity ?? {},
  );
  const selectedBotId = selection.kind === "bot" ? selection.botId : null;

  const renderRow = (row: SidebarRow): ReactElement => (
    <div
      key={rowKey(row)}
      className="draggable-row"
      draggable={canControl}
      onDragStart={(event) => {
        event.dataTransfer.setData(ROW_DRAG_TYPE, rowKey(row));
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      {row.kind === "bot" ? (
        <BotRow
          bot={row.bot}
          unread={props.unreadBots[row.bot.id] ?? 0}
          failed={props.failedByBot.get(row.bot.id) ?? 0}
          next={props.nextRun[row.bot.id]}
          activity={props.activityByBot[row.bot.id]}
          action={props.actionByBot[row.bot.id]}
          selected={selectedBotId === row.bot.id}
          canControl={canControl}
          onClick={() => {
            onSelect({ kind: "bot", botId: row.bot.id });
          }}
          onDelete={() => {
            void props.onDeleteBot(row.bot.id);
          }}
          onTogglePin={() => {
            props.onTogglePin(row.bot.id);
          }}
        />
      ) : (
        <GroupRow
          group={row.group}
          members={bots.filter((bot) => row.group.bot_ids.includes(bot.id))}
          activity={props.groupActivity?.[row.group.id]}
          selected={selection.kind === "group" && selection.groupId === row.group.id}
          onClick={() => {
            onSelect({ kind: "group", groupId: row.group.id });
          }}
        />
      )}
    </div>
  );

  return (
    <section
      className="project-section"
      onDragOver={(event) => {
        if (canControl && event.dataTransfer.types.includes(ROW_DRAG_TYPE)) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (canControl && event.dataTransfer.types.includes(ROW_DRAG_TYPE)) {
          event.preventDefault();
          void props.onPlaceRow(event.dataTransfer.getData(ROW_DRAG_TYPE), null);
        }
      }}
    >
      <div
        className={`project-header ${
          selection.kind === "project" && selection.projectId === project.id
            ? "project-header-selected"
            : ""
        }`}
      >
        <button
          type="button"
          className="project-name"
          title={collapsed ? "Show bots" : "Hide bots"}
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsed((prev) => !prev);
          }}
          onContextMenu={menu.onContextMenu}
        >
          {project.name}
        </button>
        <button
          type="button"
          className="project-menu-btn"
          title="Project menu"
          aria-label="Project menu"
          aria-haspopup="menu"
          onClick={menu.onOpenFrom}
        >
          <MoreIcon />
        </button>
      </div>

      {collapsed ? null : (
        <>
          <PinnedBots
            bots={pinnedBots}
            unreadBots={props.unreadBots}
            selectedBotId={selectedBotId}
            canControl={canControl}
            onSelect={(botId) => {
              onSelect({ kind: "bot", botId });
            }}
            onDelete={(botId) => {
              void props.onDeleteBot(botId);
            }}
            onTogglePin={props.onTogglePin}
          />

          {entries.map((entry) => {
            if (entry.kind !== "folder") {
              return renderRow(entry);
            }
            const summary = folderSummary(
              entry.rows,
              props.activityByBot,
              props.groupActivity ?? {},
              props.unreadBots,
            );
            return (
              <FolderRow
                key={entry.folder.id}
                folder={entry.folder}
                count={entry.rows.length}
                at={summary.at}
                unread={summary.unread}
                canControl={canControl}
                onRename={() => {
                  props.onRenameFolder(entry.folder);
                }}
                onDelete={() => {
                  void props.onDeleteFolder(entry.folder.id);
                }}
                onDropRow={(item) => {
                  void props.onPlaceRow(item, entry.folder.id);
                }}
              >
                {entry.rows.map((row) => renderRow(row))}
              </FolderRow>
            );
          })}
          {bots.length === 0 ? <div className="muted project-empty">No bots yet.</div> : null}
        </>
      )}

      {menu.overlays}
    </section>
  );
}
