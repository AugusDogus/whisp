/// <reference lib="es2024.promise" />
/// <reference types="bun-types/test" />
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";

let preference = Promise.withResolvers<boolean>();
let appState = "active";
const motionListeners = new Set<(enabled: boolean) => void>();
const appListeners = new Set<(state: string) => void>();
mock.module("react-native", () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => preference.promise,
    addEventListener: (
      _event: string,
      callback: (enabled: boolean) => void,
    ) => {
      motionListeners.add(callback);
      return { remove: () => motionListeners.delete(callback) };
    },
  },
  AppState: {
    get currentState() {
      return appState;
    },
    addEventListener: (_event: string, callback: (state: string) => void) => {
      appListeners.add(callback);
      return { remove: () => appListeners.delete(callback) };
    },
  },
}));
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
beforeEach(() => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  });
  preference = Promise.withResolvers<boolean>();
  appState = "active";
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(motionListeners.size).toBe(0);
  expect(appListeners.size).toBe(0);
});
afterAll(() => {
  mock.restore();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

test("motion waits for the system preference and follows visibility and foreground changes", async () => {
  await show(true);
  expect(animated).toBe(false);
  await act(async () => preference.resolve(false));
  expect(animated).toBe(true);
  await show(false);
  expect(animated).toBe(false);
  await show(true);
  expect(animated).toBe(true);
  for (const state of ["background", "inactive", "active"]) {
    await act(async () => {
      for (const callback of appListeners) callback(state);
    });
    expect(animated).toBe(state === "active");
  }
});

test("live reduced-motion changes take effect without restarting the app", async () => {
  await show(true);
  await act(async () => preference.resolve(false));
  for (const reduced of [true, false, true]) {
    await act(async () => {
      for (const callback of motionListeners) callback(reduced);
    });
    expect(animated).toBe(!reduced);
  }
});

test("a late initial preference does not overwrite a more recent system event", async () => {
  await show(true);
  await act(async () => {
    for (const callback of motionListeners) callback(true);
  });
  await act(async () => preference.resolve(false));
  expect(animated).toBe(false);
});

test("a profile mounted while backgrounded does not start animating", async () => {
  appState = "background";
  await show(true);
  await act(async () => preference.resolve(false));
  expect(animated).toBe(false);
});
