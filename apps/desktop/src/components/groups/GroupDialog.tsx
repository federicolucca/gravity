import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { Bot, BotGroup } from "../../protocol/entities";
import BotAvatar from "../BotAvatar";
import OverlayShell from "../overlay/OverlayShell";

interface GroupDialogProps {
  /** The bots of the group's project, to pick members from. */
  readonly bots: readonly Bot[];
  /** Absent for a new group. */
  readonly group?: BotGroup;
  readonly onSave: (name: string, botIds: readonly string[]) => Promise<void>;
  readonly onCancel: () => void;
}

/** Name a group and pick its members (at least two). */
export default function GroupDialog({
  bots,
  group,
  onSave,
  onCancel,
}: GroupDialogProps): ReactElement {
  const [name, setName] = useState(group?.name ?? "");
  const [picked, setPicked] = useState<readonly string[]>(group?.bot_ids ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim() !== "" && picked.length >= 2;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), picked);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };

  const title = group === undefined ? "New group" : "Edit group";
  return (
    <OverlayShell label={title} onClose={onCancel}>
      <form
        className="confirm-dialog group-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !saving) {
            void save();
          }
        }}
      >
        <h2 className="confirm-title">{title}</h2>
        <label className="group-dialog-label" htmlFor="group-name">
          Name
        </label>
        <input
          id="group-name"
          className="group-dialog-name"
          value={name}
          maxLength={60}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <p className="group-dialog-label">Members</p>
        <ul className="group-dialog-members">
          {bots.map((bot) => (
            <li key={bot.id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.includes(bot.id)}
                  onChange={(event) => {
                    const on = event.target.checked;
                    setPicked((current) =>
                      on ? [...current, bot.id] : current.filter((id) => id !== bot.id),
                    );
                  }}
                />
                <BotAvatar avatar={bot.avatar} name={bot.name} id={bot.id} size="sm" />
                <span>{bot.name}</span>
              </label>
            </li>
          ))}
        </ul>
        {error !== null ? <p className="chat-error">{error}</p> : null}
        <div className="confirm-actions">
          <button type="button" className="btn btn-small" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-small btn-primary" disabled={!valid || saving}>
            {group === undefined ? "Create group" : "Save"}
          </button>
        </div>
      </form>
    </OverlayShell>
  );
}
