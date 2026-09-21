import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import type { MediaKind } from "~/utils/media-kind";
import { whispMediaKindKey } from "~/utils/media-kind";
import { createQueryClient } from "~/utils/profile-cache";
import { SelfMessages } from "~/utils/self-messages";

import { useSentMediaKinds } from "./useSentMediaKinds";

const messageId = "shared-send";
const friends = SelfMessages.friends([], { id: "friend" }, [], true, false).map(
  (friend) => ({ ...friend, lastMessageId: messageId }),
);

test("observing a sent type never replaces the inbox query function for the same message", async () => {
  const client = createQueryClient();
  let renderer: ReactTestRenderer | undefined;
  let fetches = 0;
  let kinds: ReadonlyMap<string, MediaKind> = new Map();
  function Harness() {
    useQuery({
      queryKey: whispMediaKindKey(messageId),
      queryFn: async () => {
        fetches++;
        return "photo";
      },
    });
    kinds = useSentMediaKinds(friends);
    return null;
  }
  try {
    await act(async () => {
      renderer = create(
        createElement(QueryClientProvider, { client }, createElement(Harness)),
      );
    });
    await act(async () => {
      await client.invalidateQueries(
        { queryKey: whispMediaKindKey(messageId) },
        { throwOnError: true },
      );
    });
    await act(async () => {
      await delay(0);
    });
    expect(fetches).toBe(2);
    expect(kinds.get(messageId)).toBe("photo");
  } finally {
    await act(async () => renderer?.unmount());
    client.clear();
  }
});
