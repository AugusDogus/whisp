import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { afterEach, expect, test } from "bun:test";

import type { InboxMessage } from "~/components/friends/types";
import type { MediaKind } from "~/utils/media-kind";
import { mediaKindColor, PHOTO_COLOR, VIDEO_COLOR } from "~/utils/media-kind";
import type { OutboxStatus } from "~/utils/outbox-status";
import { SelfMessages } from "~/utils/self-messages";

import { useFriendRows } from "./useFriendRows";

const self = { id: "me", image: null };
const message: InboxMessage = {
  deliveryId: "delivery",
  messageId: "message",
  senderId: "me",
  groupId: undefined,
  fileUrl: "https://example.com/photo.jpg",
  mimeType: "image/jpeg",
  thumbhash: undefined,
  createdAt: new Date("2026-09-19T12:00:00Z"),
};
let renderer: ReactTestRenderer | undefined;
let rows: ReturnType<typeof useFriendRows> = [];

function Harness({
  outbox,
  inbox = [message],
  mediaKinds,
}: {
  outbox: OutboxStatus;
  inbox?: InboxMessage[];
  mediaKinds?: ReadonlyMap<string, MediaKind>;
}) {
  rows = useFriendRows({
    friends: SelfMessages.friends([], self, inbox, true, false),
    inbox,
    hasMedia: false,
    defaultRecipientId: undefined,
    outboxStatus: { me: outbox },
    selfUserId: self.id,
    mediaKinds,
  });
  return null;
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  rows = [];
});

test("a completed self-video upload does not override a newer unread photo", async () => {
  await act(async () => {
    renderer = create(
      createElement(Harness, {
        outbox: {
          state: "sent",
          mediaKind: "video",
          updatedAtMs: message.createdAt.getTime() - 1000,
        },
      }),
    );
  });
  expect(rows[0]).toMatchObject({
    lastMediaKind: "photo",
    lastMessageStatus: "received",
    unreadCount: 1,
    outboxState: null,
    outboxUpdatedAt: null,
  });
});

test("encrypted unread statuses gain their authenticated color without becoming read", async () => {
  const encrypted = { ...message, mimeType: "application/vnd.whisp.mls.v1" };
  const outbox: OutboxStatus = {
    state: "sent",
    mediaKind: "video",
    updatedAtMs: message.createdAt.getTime() - 1000,
  };
  await act(async () => {
    renderer = create(createElement(Harness, { outbox, inbox: [encrypted] }));
  });
  expect(rows[0]).toMatchObject({
    lastMediaKind: null,
    lastMessageStatus: "received",
    unreadCount: 1,
  });
  for (const kind of ["photo", "video"] as const) {
    await act(async () => {
      renderer?.update(
        createElement(Harness, {
          outbox,
          inbox: [encrypted],
          mediaKinds: new Map([[encrypted.deliveryId, kind]]),
        }),
      );
    });
    const row = rows[0];
    if (!row) throw new Error("Missing inbox row");
    expect(row).toMatchObject({
      lastMediaKind: kind,
      lastMessageStatus: "received",
      unreadCount: 1,
    });
    expect(mediaKindColor(row.lastMediaKind)).toBe(
      kind === "photo" ? PHOTO_COLOR : VIDEO_COLOR,
    );
  }
  const newer = {
    ...encrypted,
    deliveryId: "newer",
    messageId: "newer-message",
    createdAt: new Date(message.createdAt.getTime() + 1000),
  };
  await act(async () => {
    renderer?.update(
      createElement(Harness, {
        outbox,
        inbox: [encrypted, newer],
        mediaKinds: new Map<string, MediaKind>([
          [encrypted.deliveryId, "photo"],
        ]),
      }),
    );
  });
  expect(rows[0]).toMatchObject({
    lastMediaKind: null,
    lastMessageStatus: "received",
    unreadCount: 2,
  });
});

test("self-send shows upload feedback until the received message replaces it", async () => {
  const outbox: OutboxStatus = {
    state: "uploading",
    mediaKind: "video",
    updatedAtMs: message.createdAt.getTime() + 1000,
  };
  await act(async () => {
    renderer = create(createElement(Harness, { outbox }));
  });
  expect(rows[0]).toMatchObject({
    outboxState: "uploading",
    lastMediaKind: "video",
    lastMessageStatus: null,
  });
  await act(async () => {
    renderer?.update(
      createElement(Harness, { outbox: { ...outbox, state: "sent" } }),
    );
  });
  expect(rows[0]).toMatchObject({
    outboxState: null,
    lastMediaKind: "photo",
    lastMessageStatus: "received",
    unreadCount: 1,
  });
});
