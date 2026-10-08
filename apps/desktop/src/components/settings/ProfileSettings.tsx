import { useState } from "react";
import type { ReactElement } from "react";
import { ownerName, useProfile } from "../../app/profile";
import type { OwnerProfile } from "../../protocol/entities";
import OwnerAvatar from "../OwnerAvatar";
import { BOT_TILES } from "../botTiles";

function date(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

/** "stripe_subscription" → "Stripe subscription". */
function words(value: string | undefined): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value?: string;
}): ReactElement | null {
  return value === undefined ? null : (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">{label}</span>
      </div>
      <span className="settings-value">{value}</span>
    </div>
  );
}

function choiceLabel(value: string): string {
  if (value === "") {
    return "Gravatar";
  }
  return value === "initials" ? "Initials" : value.slice("icon:".length);
}

function Editor({ profile }: { readonly profile: OwnerProfile }): ReactElement {
  const { save } = useProfile();
  const [name, setName] = useState(profile.display_name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const dirty = name.trim() !== profile.display_name || avatar !== profile.avatar;

  const submit = async (): Promise<void> => {
    setState("saving");
    try {
      await save(name.trim(), avatar);
      setState("saved");
    } catch (error) {
      setState(error instanceof Error ? error.message : String(error));
    }
  };

  const choices = [
    ...(profile.gravatar_url ? [""] : []),
    "initials",
    ...Object.keys(BOT_TILES).map((icon) => `icon:${icon}`),
  ];
  return (
    <form
      className="settings-section"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span className="field-label">Display name</span>
        <input
          value={name}
          maxLength={60}
          placeholder={profile.claude.displayName ?? "Your name"}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <span className="field-hint">Shown in Gravity only. Empty uses your Claude name.</span>
      </label>
      <div className="field">
        <span className="field-label" id="profile-avatar-label">
          Avatar
        </span>
        <div className="avatar-picker" role="radiogroup" aria-labelledby="profile-avatar-label">
          {choices.map((value) => (
            <button
              key={value || "gravatar"}
              type="button"
              role="radio"
              aria-checked={avatar === value}
              aria-label={choiceLabel(value)}
              title={choiceLabel(value)}
              className={`avatar-choice${avatar === value ? " avatar-choice-on" : ""}`}
              onClick={() => {
                setAvatar(value);
              }}
            >
              <OwnerAvatar
                profile={profile}
                avatar={value}
                name={name.trim() || ownerName(profile)}
                size="lg"
              />
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row-control">
        <button
          type="submit"
          className="btn btn-small btn-primary"
          disabled={!dirty || state === "saving"}
        >
          Save
        </button>
        {state === "saved" ? <span className="settings-row-help">Saved.</span> : null}
        {state !== "idle" && state !== "saving" && state !== "saved" ? (
          <span className="settings-row-error">{state}</span>
        ) : null}
      </div>
    </form>
  );
}

/** Who the owner is: the Claude account on the daemon's machine, and Gravity's own name and avatar. */
export default function ProfileSettings(): ReactElement {
  const { profile } = useProfile();
  if (profile === null) {
    return <p className="settings-row-help">Connect to the daemon to see your profile.</p>;
  }
  const { claude } = profile;
  const plan = [words(claude.seatTier), words(claude.billingType)].filter(Boolean).join(" · ");
  return (
    <>
      <div className="profile-card">
        <OwnerAvatar profile={profile} size="lg" />
        <div>
          <h2>{ownerName(profile)}</h2>
          {claude.emailAddress === undefined ? null : <p>{claude.emailAddress}</p>}
        </div>
      </div>

      <h3 className="settings-subhead">Claude account</h3>
      <div className="settings-section">
        <Row label="Full name" value={claude.fullName} />
        <Row label="Organization" value={claude.organizationName} />
        <Row label="Role" value={words(claude.organizationRole)} />
        <Row label="Organization type" value={words(claude.organizationType)} />
        <Row label="Plan" value={plan === "" ? undefined : plan} />
        <Row label="Rate limit tier" value={words(claude.userRateLimitTier)} />
        <Row label="Member since" value={date(claude.accountCreatedAt)} />
        <Row label="Subscribed since" value={date(claude.subscriptionCreatedAt)} />
        <Row label="Using Claude Code since" value={date(claude.claudeCodeFirstTokenDate)} />
        <Row
          label="Claude Code sessions started"
          value={claude.numStartups === undefined ? undefined : String(claude.numStartups)}
        />
      </div>
      <p className="settings-row-help">
        Read from the Claude Code sign-in on the daemon's machine. No credentials leave it.
      </p>

      <h3 className="settings-subhead">In Gravity</h3>
      <Editor profile={profile} />
    </>
  );
}
