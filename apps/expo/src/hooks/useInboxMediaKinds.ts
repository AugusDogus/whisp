import { useMemo } from "react";

import { useQueries } from "@tanstack/react-query";

import type { InboxMessage } from "~/components/friends/types";
import type { MediaKind } from "~/utils/media-kind";
import { readWhispMediaKind, retryWhispMediaKind } from "~/utils/mls-media";

/** Resolve only the latest direct whisp per sender, which determines the row's color. */
export function useInboxMediaKinds(inbox: InboxMessage[], enabled: boolean) {
  const messages = useMemo(() => {
    const latest = new Map<string, NonNullable<InboxMessage>>();
    for (const message of inbox) {
      if (!message || message.groupId) continue;
      const previous = latest.get(message.senderId);
      if (!previous || message.createdAt > previous.createdAt)
        latest.set(message.senderId, message);
    }
    return [...latest.values()].filter(
      (message) => message.mimeType === "application/vnd.whisp.mls.v1",
    );
  }, [inbox]);
  const queries = useQueries({
    // Removing observers cancels queued metadata reads when the viewer opens,
    // so background inbox work does not sit ahead of a requested media open.
    queries: (enabled ? messages : []).map((message) => ({
      // QueryProvider already isolates accounts and servers. Cache only the type,
      // never descriptors or media keys; profile persistence excludes this key.
      queryKey: [
        "whisp-media-kind",
        message.deliveryId,
        message.messageId,
        message.senderId,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readWhispMediaKind(message, signal),
      staleTime: Infinity,
      // React Query backs retries off to 30s and cancels them when the screen
      // stops observing. A brief outage must not leave the color stuck until refresh.
      retry: retryWhispMediaKind,
    })),
  });
  const mediaKinds = new Map<string, MediaKind>();
  for (const [index, message] of messages.entries()) {
    const kind = queries[index]?.data;
    if (kind) mediaKinds.set(message.deliveryId, kind);
  }
  return { mediaKinds, hasError: queries.some((query) => query.isError) };
}
