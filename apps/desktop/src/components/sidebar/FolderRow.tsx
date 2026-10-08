import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { useState } from "react";
import type { DragEvent, ReactElement, ReactNode } from "react";
import type { SidebarFolder } from "../../protocol/entities";
import { fmtShortTime } from "../../util";
import { useRowMenu } from "./useRowMenu";

/** Drag payload type shared by the draggable rows and the drop targets. */
export const ROW_DRAG_TYPE = "text/x-gravity-row";

interface FolderRowProps {
  readonly folder: SidebarFolder;
  readonly count: number;
  /** Newest message among the folder's rows. */
  readonly at: string | undefined;
  /** Unread badges of the folder's rows, summed. */
  readonly unread: number;
  readonly canControl: boolean;
  readonly onRename: () => void;
  readonly onDelete: () => void;
  /** A dragged row (`bot:<id>` / `group:<id>`) was dropped on the folder. */
  readonly onDropRow: (item: string) => void;
  readonly children: ReactNode;
}

const COLLAPSE_KEY = "gravity.folder.collapsed.";

function readCollapsed(id: string): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY + id) !== "0";
  } catch {
    return true;
  }
}

function writeCollapsed(id: string, collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY + id, collapsed ? "1" : "0");
  } catch {
    // Remembering is a convenience; the folder works without it.
  }
}

/** A collapsible sidebar folder; collapsed it carries its rows' latest time and unread total. */
export default function FolderRow({
  folder,
  count,
  at,
  unread,
  canControl,
  onRename,
  onDelete,
  onDropRow,
  children,
}: FolderRowProps): ReactElement {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(folder.id));
  const [over, setOver] = useState(false);
  const menu = useRowMenu({
    items: canControl ? [{ label: "Rename folder", onSelect: onRename }] : [],
    deletion: canControl
      ? {
          label: "Delete folder",
          title: "Delete folder",
          body: `"${folder.name}" is removed; its ${count} rows go back to the project list.`,
          confirmLabel: "Delete folder",
          onConfirm: onDelete,
        }
      : null,
  });
  const accepts = (event: DragEvent): boolean =>
    canControl && event.dataTransfer.types.includes(ROW_DRAG_TYPE);

  return (
    <div
      className={`folder${over ? " folder-over" : ""}`}
      onDragOver={(event) => {
        if (accepts(event)) {
          event.preventDefault();
          event.stopPropagation();
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={(event) => {
        setOver(false);
        if (accepts(event)) {
          event.preventDefault();
          event.stopPropagation();
          onDropRow(event.dataTransfer.getData(ROW_DRAG_TYPE));
        }
      }}
    >
      <div className="folder-head">
        <button
          type="button"
          className="row folder-toggle"
          aria-expanded={!collapsed}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            writeCollapsed(folder.id, next);
          }}
          onContextMenu={menu.onContextMenu}
        >
          <span className="folder-chevron" aria-hidden="true">
            {collapsed ? (
              <ChevronRight size={14} strokeWidth={2} />
            ) : (
              <ChevronDown size={14} strokeWidth={2} />
            )}
          </span>
          <Folder size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="folder-name">{folder.name}</span>
          {at === undefined ? null : <span className="bot-row-time">{fmtShortTime(at)}</span>}
          {collapsed && unread > 0 ? <span className="badge badge-unread">{unread}</span> : null}
        </button>
      </div>
      {collapsed ? null : (
        <div className="folder-body">
          {count === 0 ? <div className="muted folder-empty">Drag chats here.</div> : children}
        </div>
      )}
      {menu.overlays}
    </div>
  );
}
