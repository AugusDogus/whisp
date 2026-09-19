/// <reference types="bun-types/test" />
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { trpc } from "~/utils/api";

import { createProfileFixture, settle } from "../test/discord-profile";

let fixture: ReturnType<typeof createProfileFixture>;

const { useDiscordProfile } = await import("./useDiscordProfile");
let latest: ReturnType<typeof useDiscordProfile> | undefined;
let renderer: ReactTestRenderer | undefined;
function Harness({ enabled }: { enabled: boolean }) {
  latest = useDiscordProfile("me", enabled);
  return null;
}
function tree(enabled: boolean) {
  return createElement(
    fixture.Provider,
    null,
    createElement(Harness, { enabled }),
  );
}
async function show(enabled: boolean) {
  await act(async () => {
    if (renderer) renderer.update(tree(enabled));
    else renderer = create(tree(enabled));
  });
  await settle();
}

beforeEach(() => {
  fixture = createProfileFixture();
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  latest = undefined;
  fixture.queryClient.clear();
});

test("a failed automatic sync keeps saved cosmetics and retries when revisited", async () => {
  await show(true);
  expect(fixture.state.requests.length).toBe(1);
  expect(latest?.profile.data?.profile.cosmetics?.bannerUrl).toBe(
    "saved-banner.png",
  );
  expect(latest?.refreshError).toBe("Discord unavailable");
  await settle();
  expect(fixture.state.requests.length).toBe(1);
  await show(false);
  fixture.state.unavailable = false;
  await show(true);
  expect(fixture.state.requests.length).toBe(2);
  expect(latest?.refreshError).toBeNull();
  expect(latest?.profile.data?.needsRefresh).toBe(false);
});

test("returning while a refresh is pending does not start another request", async () => {
  fixture.state.holdRefresh = true;
  await show(true);
  expect(fixture.state.requests.length).toBe(1);
  await show(false);
  await show(true);
  expect(fixture.state.requests.length).toBe(1);
  fixture.state.unavailable = false;
  await act(async () => {
    fixture.state.finishRefresh?.();
  });
  await settle();
  expect(fixture.state.requests.length).toBe(1);
});

test("saved friend cosmetics are available before the sheet opens without a second read", async () => {
  fixture.state.stored.needsRefresh = false;
  fixture.queryClient.setQueryData(
    getQueryKey(trpc.friends.list, undefined, "query"),
    [{ id: "me", discordProfile: fixture.state.stored }],
  );
  await show(false);
  expect(latest?.profile.data).toEqual(fixture.state.stored);
  await show(true);
  expect(fixture.state.reads).toBe(0);
  expect(fixture.state.requests).toHaveLength(0);
});

test("an old friend-list snapshot still revalidates when opened", async () => {
  fixture.state.stored.needsRefresh = false;
  fixture.queryClient.setQueryData(
    getQueryKey(trpc.friends.list, undefined, "query"),
    [{ id: "me", discordProfile: fixture.state.stored }],
    { updatedAt: Date.now() - 6 * 60 * 1000 },
  );
  await show(false);
  expect(latest?.profile.data).toEqual(fixture.state.stored);
  expect(fixture.state.reads).toBe(0);
  await show(true);
  expect(fixture.state.reads).toBe(1);
});
