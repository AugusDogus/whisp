import { useEffect, useRef } from "react";

import { trpc } from "~/utils/api";

export function useDiscordProfile(userId: string, enabled: boolean) {
  const utils = trpc.useUtils();
  const profile = trpc.auth.discordProfile.useQuery(
    { userId },
    { enabled, retry: false },
  );
  const refresh = trpc.auth.refreshAvatar.useMutation({
    onSuccess: async (result, input) => {
      if (!result.success) return;
      await utils.auth.discordProfile.cancel({ userId: input.userId });
      utils.auth.discordProfile.setData(
        { userId: input.userId },
        {
          profile: result.profile,
          needsRefresh: result.needsRefresh,
        },
      );
      void utils.friends.list.invalidate();
    },
  });
  const { mutate } = refresh;
  const isRefreshing = refresh.isPending;
  const attemptedVersion = useRef<string | null>(null);
  const lastSyncedAt = profile.data?.profile.cosmetics?.lastSyncedAt ?? null;
  const needsRefresh = profile.data?.needsRefresh === true;

  // Refresh independently of the read so saved cosmetics stay visible during
  // Discord outages. Retry on the next visit, without looping on failures or
  // starting another request while the previous visit's refresh is pending.
  useEffect(() => {
    if (!enabled) {
      attemptedVersion.current = null;
      return;
    }
    const version = JSON.stringify([userId, lastSyncedAt]);
    if (isRefreshing || !needsRefresh || attemptedVersion.current === version)
      return;
    attemptedVersion.current = version;
    mutate({ userId, mode: "if-stale" });
  }, [enabled, needsRefresh, isRefreshing, userId, lastSyncedAt, mutate]);

  const refreshError =
    refresh.error?.message ??
    (refresh.data?.success === false ? refresh.data.error : null);

  return {
    profile,
    refreshError,
    isRefreshing: refresh.isPending,
  };
}
