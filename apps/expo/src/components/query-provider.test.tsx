import type { QueryClient } from "@tanstack/react-query";

import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { afterEach, expect, mock, test } from "bun:test";

import { trpc } from "~/utils/api";

import { createProfileFixture, settle } from "../test/discord-profile";
import { native } from "../test/setup";

const files = new Map<string, string>();
mock.module("~/utils/profile-cache-storage", () => ({
  profileCacheStorage: {
    getItem: async (key: string) => files.get(key) ?? null,
    setItem: (key: string, value: string) => {
      files.set(key, value);
    },
    removeItem: (key: string) => {
      files.delete(key);
    },
  },
}));
const { QueryProvider } = await import("./query-provider");
const profileKey = getQueryKey(
  trpc.auth.discordProfile,
  { userId: "friend" },
  "query",
);
let current: QueryClient | undefined;
let renderer: ReactTestRenderer | undefined;
const displayed: unknown[] = [];
function Probe() {
  current = useQueryClient();
  displayed.push(current.getQueryData(profileKey));
  return null;
}
async function show(userId: string | null) {
  native.userId = userId;
  await act(async () => {
    const tree = (
      <QueryProvider>
        <Probe />
      </QueryProvider>
    );
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
  await settle();
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  current = undefined;
  displayed.length = 0;
  files.clear();
});

test("account changes isolate memory and sign-out deletes persisted data", async () => {
  const fixture = createProfileFixture();
  await show("account-a");
  const accountA = current;
  if (!accountA) throw new Error("Expected the first account query client");
  accountA.setQueryData(profileKey, fixture.state.stored);
  await settle();
  expect(files.size).toBe(1);
  await show("account-a");
  expect(current).toBe(accountA);
  expect(displayed.at(-1)).toEqual(fixture.state.stored);

  displayed.length = 0;
  await show("account-b");
  expect(current).not.toBe(accountA);
  expect(displayed.every((data) => data === undefined)).toBe(true);
  expect(accountA.getQueryCache().getAll()).toHaveLength(0);
  current?.setQueryData(profileKey, fixture.state.stored);
  await settle();
  expect(files.size).toBe(1);

  await show(null);
  expect(current?.getQueryData(profileKey)).toBeUndefined();
  expect(files.size).toBe(0);
  fixture.queryClient.clear();
});

test("the account is resolved before any cached screen renders", async () => {
  native.sessionPending = true;
  await show(null);
  expect(displayed).toHaveLength(0);
  native.sessionPending = false;
  await show("account-a");
  expect(displayed.length).toBeGreaterThan(0);
});
