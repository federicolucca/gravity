import { useCallback, useEffect, useMemo, useState } from "react";
import type { DaemonApi } from "../protocol/api";
import type { OwnerProfile } from "../protocol/entities";
import type { ProfileApi } from "./profile";

function fromReply(reply: OwnerProfile): OwnerProfile {
  return { claude: reply.claude, display_name: reply.display_name, avatar: reply.avatar };
}

/** Loads the owner's profile on connect; `save` stores Gravity's own name and avatar. */
export function useOwnerProfile(client: DaemonApi, connected: boolean): ProfileApi {
  const [profile, setProfile] = useState<OwnerProfile | null>(null);

  useEffect(() => {
    if (!connected) {
      return;
    }
    let alive = true;
    client
      .request({ type: "get_profile" }, "profile")
      .then((reply) => {
        if (alive) {
          setProfile(fromReply(reply));
        }
        return undefined;
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [client, connected]);

  const save = useCallback(
    async (displayName: string, avatar: string): Promise<void> => {
      const reply = await client.request(
        { type: "save_profile", display_name: displayName, avatar },
        "profile",
      );
      setProfile(fromReply(reply));
    },
    [client],
  );

  return useMemo(() => ({ profile, save }), [profile, save]);
}
