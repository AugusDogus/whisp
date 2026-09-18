/// <reference types="bun-types/test" />
import { createElement, useEffect } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import type { ImageProps } from "expo-image";

import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";

const images = new Set<ImageProps>();
function ImageStub(props: ImageProps) {
  useEffect(() => {
    images.add(props);
    return () => {
      images.delete(props);
    };
  }, [props]);
  return null;
}
mock.module("expo-image", () => ({ Image: ImageStub }));
mock.module("react-native", () => ({
  View: "view",
  StyleSheet: { absoluteFill: { position: "absolute" } },
}));
mock.module("~/utils/auth", () => ({
  authClient: { getCookie: () => "test-session" },
}));
mock.module("~/utils/base-url", () => ({
  getBaseUrl: () => "http://localhost:3000",
}));
const { DiscordNameplate } = await import("./discord-nameplate");
let renderer: ReactTestRenderer | undefined;
async function show(animate: boolean) {
  await act(async () => {
    const tree = createElement(DiscordNameplate, {
      userId: "friend",
      staticUrl: "https://cdn.discordapp.com/static.png",
      animate,
    });
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
}
beforeEach(() =>
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    configurable: true,
  }),
);
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(images.size).toBe(0);
});
afterAll(() => {
  mock.restore();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

test("paused nameplates never mount the animation request", async () => {
  await show(false);
  expect(images.size).toBe(1);
  expect([...images].some((image) => image.autoplay)).toBe(false);
  await show(true);
  const animation = [...images].find((image) => image.autoplay);
  expect(animation?.source).toMatchObject({
    headers: { Cookie: "test-session" },
  });
  await show(false);
  expect(images.size).toBe(1);
  expect([...images].some((image) => image.autoplay)).toBe(false);
});

test("a failed animation leaves the static image visible and retries on the next visit", async () => {
  await show(true);
  const animation = [...images].find((image) => image.autoplay);
  if (!animation?.onError)
    throw new Error("Expected animated nameplate error handler");
  await act(async () => animation.onError?.({ error: "Network unavailable" }));
  expect(images.size).toBe(1);
  expect([...images][0]?.style).toContainEqual({ opacity: 1 });
  await show(false);
  await show(true);
  expect([...images].some((image) => image.autoplay)).toBe(true);
});
