import type { ComponentType } from "react";
import { createElement, useEffect, useLayoutEffect } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";

import { afterEach, expect, mock, test } from "bun:test";

import { native } from "../test/setup";
const { createForegroundApp } = await import("./foreground-app");

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

async function show(App: ComponentType) {
  await act(async () => {
    renderer = create(createElement(App));
  });
}

async function change(state: string) {
  await act(async () => {
    native.appState = state;
    for (const listener of native.appListeners) listener(state);
  });
}

test.each(["background", "inactive", "unknown"])(
  "does not import protected app modules on %s startup",
  async (state) => {
    native.appState = state;
    const load = mock(async () => {
      if (native.appState !== "active") throw new Error("Keychain is locked");
      return { default: () => null };
    });
    await show(createForegroundApp(load));
    expect(load).not.toHaveBeenCalled();
    await change("active");
    expect(load).toHaveBeenCalledTimes(1);
  },
);

test("starts on an already active launch and preserves the mounted app across backgrounding", async () => {
  native.appState = "active";
  const mounted = mock(() => {});
  const unmounted = mock(() => {});
  const load = mock(async () => ({
    default: function App() {
      useEffect(() => {
        mounted();
        return unmounted;
      }, []);
      return null;
    },
  }));
  await show(createForegroundApp(load));
  await change("background");
  await change("active");
  expect(load).toHaveBeenCalledTimes(1);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});

test("notices activation between the first render and its subscription", async () => {
  native.appState = "background";
  const load = mock(async () => ({ default: () => null }));
  const App = createForegroundApp(load);
  function ActivateBeforeSubscription() {
    useLayoutEffect(() => {
      native.appState = "active";
    }, []);
    return <App />;
  }
  await show(ActivateBeforeSubscription);
  expect(load).toHaveBeenCalledTimes(1);
});

test("does not first mount the app in background if a lazy load finishes after deactivation", async () => {
  native.appState = "active";
  let resolve: ((app: { default: ComponentType }) => void) | undefined;
  const pending = new Promise<{ default: ComponentType }>((done) => {
    resolve = done;
  });
  const render = mock(() => null);
  await show(createForegroundApp(() => pending));
  await change("background");
  await act(async () => {
    resolve?.({ default: render });
  });
  expect(render).not.toHaveBeenCalled();
  await change("active");
  expect(render).toHaveBeenCalled();
});
