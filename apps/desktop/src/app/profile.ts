import { createContext, useContext } from "react";
import type { OwnerProfile } from "../protocol/entities";

export interface ProfileApi {
  /** `null` before the first load, or without a connection. */
  readonly profile: OwnerProfile | null;
  readonly save: (displayName: string, avatar: string) => Promise<void>;
}

const NO_PROFILE: ProfileApi = {
  profile: null,
  save: async () => {
    throw new Error("not connected");
  },
};

export const ProfileContext = createContext<ProfileApi>(NO_PROFILE);

export function useProfile(): ProfileApi {
  return useContext(ProfileContext);
}

/** The name to show for the owner. */
export function ownerName(profile: OwnerProfile | null): string {
  if (profile === null) {
    return "You";
  }
  return profile.display_name || profile.claude.displayName || profile.claude.fullName || "You";
}
