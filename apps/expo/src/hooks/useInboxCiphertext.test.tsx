/// <reference lib="es2024.promise" />
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";

import { native } from "../test/setup";
import * as ciphertext from "../utils/whisp-ciphertext";
import { useInboxCiphertext } from "./useInboxCiphertext";

const retained = spyOn(ciphertext, "retainWhispCiphertexts");
const prefetched = spyOn(ciphertext, "prefetchWhispCiphertext");
let renderer: ReactTestRenderer | undefined;
function message(id: number, mimeType = "application/vnd.whisp.mls.v1") {
  return {
    messageId: String(id),
    fileUrl: `https://media.test/${id}`,
    mimeType,
    createdAt: new Date(id),
  };
}
const inbox = [
  message(1),
  message(2),
  message(3),
  message(4),
  message(5, "image/jpeg"),
];
function Harness({ enabled }: { enabled: boolean }) {
  useInboxCiphertext(inbox, "alice", enabled);
  return null;
}
async function show(enabled: boolean) {
  await act(async () => {
    const tree = createElement(Harness, { enabled });
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
}
beforeEach(() => {
  retained.mockReset().mockResolvedValue(undefined);
  prefetched.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(native.appListeners.size).toBe(0);
});
afterAll(() => {
  retained.mockRestore();
  prefetched.mockRestore();
});

test("an inactive inbox does not evict another screen's ciphertext", async () => {
  await show(false);
  expect(retained).not.toHaveBeenCalled();
  expect(prefetched).not.toHaveBeenCalled();
  await show(true);
  expect(retained).toHaveBeenCalledTimes(1);
  expect(prefetched.mock.calls.map(([item]) => item.messageId)).toEqual([
    "4",
    "3",
    "2",
  ]);
  await show(false);
  expect(retained).toHaveBeenCalledTimes(1);
});

test("opening a viewer stops scheduling but preserves the current transfer", async () => {
  const pending = Promise.withResolvers<void>();
  prefetched.mockImplementationOnce(() => pending.promise);
  await show(true);
  expect(prefetched).toHaveBeenCalledTimes(1);
  // No lifecycle AbortSignal is attached to the admitted transfer.
  expect(prefetched.mock.calls[0]).toHaveLength(2);
  await show(false);
  await act(async () => pending.resolve());
  expect(prefetched).toHaveBeenCalledTimes(1);
});

test("a backgrounded inbox neither schedules downloads nor retains cache entries", async () => {
  native.appState = "background";
  await show(true);
  expect(retained).not.toHaveBeenCalled();
  expect(prefetched).not.toHaveBeenCalled();
  await act(async () => {
    for (const callback of native.appListeners) callback("active");
  });
  expect(retained).toHaveBeenCalledTimes(1);
  expect(prefetched).toHaveBeenCalledTimes(3);
});
