/// <reference lib="es2024.promise" />
/// <reference types="bun-types/test" />
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { afterEach, expect, test } from "bun:test";

import { native } from "../test/setup";

const { useCosmeticMotion } = await import("./useCosmeticMotion");
let animated = false;
let renderer: ReactTestRenderer | undefined;
function Harness({ visible }: { visible: boolean }) {
  animated = useCosmeticMotion(visible);
  return null;
}
async function show(visible: boolean) {
  await act(async () => {
    const tree = createElement(Harness, { visible });
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(native.motionListeners.size).toBe(0);
  expect(native.appListeners.size).toBe(0);
});

test("motion waits for the system preference and follows visibility and foreground changes", async () => {
  await show(true);
  expect(animated).toBe(false);
  await act(async () => native.preference.resolve(false));
  expect(animated).toBe(true);
  await show(false);
  expect(animated).toBe(false);
  await show(true);
  expect(animated).toBe(true);
  for (const state of ["background", "inactive", "active"]) {
    await act(async () => {
      for (const callback of native.appListeners) callback(state);
    });
    expect(animated).toBe(state === "active");
  }
});

test("live reduced-motion changes take effect without restarting the app", async () => {
  await show(true);
  await act(async () => native.preference.resolve(false));
  for (const reduced of [true, false, true]) {
    await act(async () => {
      for (const callback of native.motionListeners) callback(reduced);
    });
    expect(animated).toBe(!reduced);
  }
});

test("a late initial preference does not overwrite a more recent system event", async () => {
  await show(true);
  await act(async () => {
    for (const callback of native.motionListeners) callback(true);
  });
  await act(async () => native.preference.resolve(false));
  expect(animated).toBe(false);
});

test("a profile mounted while backgrounded does not start animating", async () => {
  native.appState = "background";
  await show(true);
  await act(async () => native.preference.resolve(false));
  expect(animated).toBe(false);
});
