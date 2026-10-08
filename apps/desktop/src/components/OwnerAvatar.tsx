import { useState } from "react";
import type { ReactElement } from "react";
import { ownerName } from "../app/profile";
import type { OwnerProfile } from "../protocol/entities";
import BotAvatar from "./BotAvatar";

/**
 * The owner's avatar. An empty pick means Gravatar for their Claude email,
 * falling back to initials when they have none (Gravatar answers 404).
 */
export default function OwnerAvatar({
  profile,
  avatar = profile.avatar,
  name = ownerName(profile),
  size = "md",
}: {
  readonly profile: OwnerProfile;
  /** Overrides the saved pick, for a live preview. */
  readonly avatar?: string;
  readonly name?: string;
  readonly size?: "sm" | "md" | "lg";
}): ReactElement {
  const [failed, setFailed] = useState<string | null>(null);
  const src = profile.gravatar_url ?? undefined;
  if (avatar === "" && src !== undefined && failed !== src) {
    return (
      <img
        className={`bot-avatar bot-avatar-${size} owner-photo`}
        src={src}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => {
          setFailed(src);
        }}
      />
    );
  }
  return (
    <BotAvatar avatar={avatar === "initials" ? "" : avatar} name={name} id="owner" size={size} />
  );
}
