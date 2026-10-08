import { Users } from "lucide-react";
import type { ReactElement } from "react";
import type { Bot, BotGroup } from "../../protocol/entities";

interface GroupRowProps {
  readonly group: BotGroup;
  readonly members: readonly Bot[];
  readonly selected: boolean;
  readonly onClick: () => void;
}

/** A group chat in the sidebar, under its project's bots. */
export default function GroupRow({
  group,
  members,
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
        <span className="bot-row-name">{group.name}</span>
        <span className={`bot-row-status ${working.length > 0 ? "status-busy" : ""}`}>
          {working.length > 0
            ? `${working.map((bot) => bot.name).join(", ")} working`
            : members.map((bot) => bot.name).join(", ")}
        </span>
      </span>
    </button>
  );
}
