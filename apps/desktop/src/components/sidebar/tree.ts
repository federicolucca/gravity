import type { Selection } from "../../app/selection";
import type { BotActivity, BotGroup, SidebarFolder } from "../../protocol/entities";
import type { GroupActivity } from "./groupActivity";

/** Per-row badge inputs shared by the sidebar and each project section. */
export interface SidebarTreeProps {
  readonly unreadBots: Readonly<Record<string, number>>;
  readonly failedByBot: ReadonlyMap<string, number>;
  readonly nextRun: Readonly<Record<string, string>>;
  /** Pinned bot ids in display order; those bots move to the pinned strip. */
  readonly pinnedBotIds: readonly string[];
  readonly activityByBot: Readonly<Record<string, BotActivity>>;
  /** What each working bot is doing now, keyed by bot id. */
  readonly actionByBot: Readonly<Record<string, string>>;
  /** Group chats of every project; each section shows its own. */
  readonly groups: readonly BotGroup[];
  /** Newest message and unread replies per group, keyed by group id. */
  readonly groupActivity?: Readonly<Record<string, GroupActivity>>;
  /** Sidebar folders of every project; each section shows its own. */
  readonly folders: readonly SidebarFolder[];
  readonly onNewFolder: (projectId: string) => void;
  readonly onRenameFolder: (folder: SidebarFolder) => void;
  readonly onDeleteFolder: (folderId: string) => Promise<void>;
  /** Moves a row (`bot:<id>` / `group:<id>`) into a folder, or out of any (`null`). */
  readonly onPlaceRow: (item: string, folderId: string | null) => Promise<void>;
  readonly onNewGroup: (projectId: string) => void;
  /** Opens the live stats of the daemon's machine. */
  readonly onOpenMachine: () => void;
  readonly selection: Selection;
  readonly canControl: boolean;
  readonly onSelect: (selection: Selection) => void;
  /** Creates a placeholder bot in the project; the sidebar tracks the request. */
  readonly onCreateBot: (projectId: string) => void;
  readonly onDeleteBot: (botId: string) => Promise<void>;
  readonly onDeleteProject: (projectId: string) => Promise<void>;
  readonly onTogglePin: (botId: string) => void;
}
