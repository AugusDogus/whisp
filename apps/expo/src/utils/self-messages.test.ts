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
  expect(SelfMessages.friends([], self, [], false, true)).toEqual([]);
  expect(SelfMessages.friends([], self, [], true, true)).toMatchObject([
    { id: "me", name: "Me (testing)" },
  ]);
});

test("turning off hides self from recipients but preserves unread messages", () => {
  expect(SelfMessages.friends([], self, [message], false, true)).toEqual([]);
  expect(SelfMessages.friends([], self, [message], false, false)).toMatchObject(
    [{ id: "me", name: "Me (testing)" }],
  );
  expect(SelfMessages.friends([], self, [], false, false)).toEqual([]);
});

test("group messages and other people's messages do not create a self row", () => {
  expect(
    SelfMessages.friends(
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
  const existing = SelfMessages.friends([], self, [], true, true);
  expect(SelfMessages.friends(existing, self, [], false, true)).toEqual([]);
  expect(SelfMessages.friends(existing, self, [], true, true)).toHaveLength(1);
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

test("changing the self preference preserves other friend rows", () => {
  const others = SelfMessages.friends([], { id: "friend" }, [], true, true);
  expect(SelfMessages.friends(others, self, [], false, true)).toEqual(others);
});
