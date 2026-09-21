import { useQueries } from "@tanstack/react-query";

import type { FriendRowInput } from "~/components/friends/types";
import { whispMediaKindKey, type MediaKind } from "~/utils/media-kind";

/** Observe types recorded during local sends without retaining media or keys. */
export function useSentMediaKinds(friends: FriendRowInput[]) {
  const messageIds = [
    ...new Set(
      friends.flatMap((friend) =>
        friend.lastMessageId ? [friend.lastMessageId] : [],
      ),
    ),
  ];
  const queries = useQueries({
    queries: messageIds.map((messageId) => ({
      queryKey: whispMediaKindKey(messageId),
      enabled: false,
    })),
  });
  const kinds = new Map<string, MediaKind>();
  for (const [index, messageId] of messageIds.entries()) {
    const kind = queries[index]?.data;
    if (kind === "photo" || kind === "video") kinds.set(messageId, kind);
  }
  return kinds;
}
