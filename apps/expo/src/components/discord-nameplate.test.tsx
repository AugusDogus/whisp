/// <reference types="bun-types/test" />
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { afterEach, expect, test } from "bun:test";

import { images } from "../test/setup";

const { DiscordNameplate } = await import("./discord-nameplate");
let renderer: ReactTestRenderer | undefined;
async function show(animate: boolean) {
  await act(async () => {
    const tree = createElement(DiscordNameplate, {
      staticUrl:
        "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/static.png",
      animate,
    });
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(images.size).toBe(0);
});

test("paused nameplates never mount the animation request", async () => {
  await show(false);
  expect(images.size).toBe(1);
  expect([...images].some((image) => image.autoplay)).toBe(false);
  await show(true);
  const animation = [...images].find((image) => image.autoplay);
  expect(animation?.source).toEqual({
    uri: "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/img.png?passthrough=true",
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
