import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { afterEach, beforeEach, expect, test } from "bun:test";

import type { InboxMessage } from "~/components/friends/types";
import { trpc } from "~/utils/api";

import { createProfileFixture, settle } from "../test/discord-profile";
import { useMessageFromNotification } from "./useMessageFromNotification";

let fixture: ReturnType<typeof createProfileFixture>;
let renderer: ReactTestRenderer | undefined;
const message: InboxMessage = {
  deliveryId: "d",
  messageId: "m",
  senderId: "sender",
  groupId: undefined,
  fileUrl: "https://example.com/private",
  mimeType: undefined,
  thumbhash: undefined,
  createdAt: new Date(),
};
beforeEach(() => {
  fixture = createProfileFixture();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  fixture.queryClient.clear();
});

async function show() {
  const response = Promise.withResolvers<{ data: InboxMessage[] }>();
  const opened: InboxMessage[][] = [];
  const read: string[] = [];
  let cleared = 0;
  function Harness() {
    const utils = trpc.useUtils();
    useMessageFromNotification({
      senderId: "sender",
      viewerOpen: false,
      utils,
      refetchInbox: () => response.promise,
      clearParams: () => {
        cleared++;
      },
      openViewer: (messages) => opened.push(messages),
      markAsRead: (id) => read.push(id),
    });
    return null;
  }
  await act(async () => {
    renderer = create(
      <fixture.Provider>
        <Harness />
      </fixture.Provider>,
    );
  });
  return { response, opened, read, cleared: () => cleared };
}

test("a notification cannot open a delivery that the server no longer permits", async () => {
  fixture.queryClient.setQueryData(
    [["messages", "inbox"], { type: "query" }],
    [message],
  );
  const state = await show();
  expect(state.opened).toEqual([]);
  state.response.resolve({ data: [] });
  await settle();
  expect(state.opened).toEqual([]);
  expect(state.read).toEqual([]);
  expect(state.cleared()).toBe(1);
});

test("permitted notifications open only the freshly returned messages", async () => {
  const state = await show();
  state.response.resolve({ data: [message] });
  await settle();
  expect(state.opened).toEqual([[message]]);
  expect(state.read).toEqual(["d"]);
});

test("a pending notification fetch does not open a viewer after unmount", async () => {
  const state = await show();
  await act(async () => renderer?.unmount());
  renderer = undefined;
  state.response.resolve({ data: [message] });
  await settle();
  expect(state.opened).toEqual([]);
});
