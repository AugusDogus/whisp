import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "bun:test";

import {
  getOutboxStatusSnapshot,
  markWhispPending,
  subscribeOutboxStatus,
} from "./outbox-status";

test("account switches isolate pending sends and late updates", () => {
  const first = new QueryClient();
  const second = new QueryClient();
  markWhispPending(first, ["shared-friend"], "blocked", "photo");
  first.clear();

  let notifications = 0;
  const unsubscribe = subscribeOutboxStatus(second, () => notifications++);
  expect(getOutboxStatusSnapshot(second)).toEqual({});
  markWhispPending(first, ["shared-friend"], "retrying", "photo");
  expect(notifications).toBe(1);
  expect(getOutboxStatusSnapshot(second)).toEqual({});

  markWhispPending(second, ["shared-friend"], "uploading", "video");
  expect(notifications).toBe(2);
  expect(getOutboxStatusSnapshot(second)["shared-friend"]).toMatchObject({
    state: "uploading",
    mediaKind: "video",
  });
  expect(getOutboxStatusSnapshot(first)["shared-friend"]?.state).toBe(
    "retrying",
  );
  unsubscribe();
});
