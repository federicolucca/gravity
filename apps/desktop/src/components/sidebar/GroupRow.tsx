import { Users } from "lucide-react";
import type { ReactElement } from "react";
import type { Bot, BotGroup } from "../../protocol/entities";
import { fmtShortTime } from "../../util";
import type { GroupActivity } from "./groupActivity";

interface GroupRowProps {
  readonly group: BotGroup;
  readonly members: readonly Bot[];
  readonly activity?: GroupActivity;
  readonly selected: boolean;
  readonly onClick: () => void;
}

/** A group chat in the sidebar, under its project's bots. */
export default function GroupRow({
  group,
  members,
  activity,
  selected,
  onClick,
}: GroupRowProps): ReactElement {
  const working = members.filter((bot) => bot.state === "working");
  return (
    <button
      type="button"
      className={`row bot-row group-row ${selected ? "row-selected" : ""}`}
      onClick={onClick}
    >
      <span className="group-row-icon" aria-hidden="true">
        <Users size={18} strokeWidth={1.75} />
      </span>
      <span className="group-row-text">
        <span className="bot-row-top">
          <span className="bot-row-name">{group.name}</span>
          {activity === undefined ? null : (
            <span className="bot-row-time">{fmtShortTime(activity.at)}</span>
          )}
        </span>
        <span className="bot-row-bottom">
          <span className={`bot-row-status ${working.length > 0 ? "status-busy" : ""}`}>
            {working.length > 0
              ? `${working.map((bot) => bot.name).join(", ")} working`
              : members.map((bot) => bot.name).join(", ")}
          </span>
          {activity !== undefined && activity.unread > 0 ? (
            <span className="badge badge-unread">{activity.unread}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
