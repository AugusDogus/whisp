import { expect, test } from "bun:test";

import type { InboxMessage } from "~/components/friends/types";

import { SelfMessages } from "./self-messages";

const self = { id: "me", image: null };
const message: InboxMessage = {
  deliveryId: "delivery",
  messageId: "message",
  senderId: "me",
  groupId: undefined,
  fileUrl: "https://example.com/photo.jpg",
  mimeType: "image/jpeg",
  thumbhash: undefined,
  createdAt: new Date(),
};

test("the toggle adds a self recipient even when the server flag is off", () => {
  expect(SelfMessages.rows([], self, [], false, true)).toEqual([]);
  expect(SelfMessages.rows([], self, [], true, true)).toMatchObject([
    { id: "me", name: "Me (testing)", unreadCount: 0 },
  ]);
});

test("turning off hides self from recipients but preserves unread messages", () => {
  expect(SelfMessages.rows([], self, [message], false, true)).toEqual([]);
  expect(SelfMessages.rows([], self, [message], false, false)).toMatchObject([
    { id: "me", hasUnread: true, unreadCount: 1, lastMediaKind: "photo" },
  ]);
  expect(SelfMessages.rows([], self, [], false, false)).toEqual([]);
});

test("group messages and other people's messages do not create a self row", () => {
  expect(
    SelfMessages.rows(
      [],
      self,
      [
        null,
        { ...message, groupId: "group" },
        { ...message, senderId: "friend" },
      ],
      false,
      false,
    ),
  ).toEqual([]);
});

test("server-provided self entries cannot override the local toggle or duplicate Me", () => {
  const existing = SelfMessages.rows([], self, [], true, true);
  expect(SelfMessages.rows(existing, self, [], false, true)).toEqual([]);
  expect(SelfMessages.rows(existing, self, [], true, true)).toHaveLength(1);
});

test("turning off blocks stale self selections without dropping other recipients", () => {
  const selected = new Set(["me", "friend"]);
  expect(SelfMessages.recipients(selected, "me", false)).toEqual(["friend"]);
  expect(SelfMessages.recipients(selected, "me", true)).toEqual([
    "me",
    "friend",
  ]);
  expect(SelfMessages.recipients(selected, "friend", false)).toEqual(["me"]);
});

test("self-send keeps upload feedback and lets received messages replace sent status", () => {
  const outbox = { state: "uploading", updatedAtMs: Date.now() } as const;
  expect(
    SelfMessages.rows([], self, [], true, false, outbox)[0]?.outboxState,
  ).toBe("uploading");
  expect(
    SelfMessages.rows([], self, [message], true, false, {
      ...outbox,
      state: "sent",
    })[0],
  ).toMatchObject({
    outboxState: null,
    lastMessageStatus: "received",
    unreadCount: 1,
  });
});

test("changing the self preference preserves other friend rows", () => {
  const others = SelfMessages.rows([], { id: "friend" }, [], true, true);
  expect(SelfMessages.rows(others, self, [], false, true)).toEqual(others);
});
