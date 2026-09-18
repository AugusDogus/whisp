/// <reference types="bun-types/test" />
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";

import type { RouterInputs, RouterOutputs } from "@acme/api";

type Profile = RouterOutputs["auth"]["discordProfile"];
type RefreshResult = RouterOutputs["auth"]["refreshAvatar"];
type RefreshInput = RouterInputs["auth"]["refreshAvatar"];
const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});
let stored: Profile;
let unavailable = true;
let requests = 0;
let finishRefresh: (() => void) | undefined;
let holdRefresh = false;
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});

mock.module("~/utils/api", () => ({
  trpc: {
    useUtils: () => ({
      auth: {
        discordProfile: {
          cancel: ({ userId }: { userId: string }) =>
            client.cancelQueries({ queryKey: ["profile", userId] }),
          setData: ({ userId }: { userId: string }, data: Profile) =>
            client.setQueryData(["profile", userId], data),
        },
      },
      friends: { list: { invalidate: async () => {} } },
    }),
    auth: {
      discordProfile: {
        useQuery: (
          input: { userId: string },
          options: { enabled: boolean; retry: false },
        ) =>
          useQuery({
            queryKey: ["profile", input.userId],
            queryFn: async () => stored,
            ...options,
          }),
      },
      refreshAvatar: {
        useMutation: (options: {
          onSuccess: (
            result: RefreshResult,
            input: RefreshInput,
          ) => Promise<void>;
        }) =>
          useMutation({
            mutationFn: async (
              _input: RefreshInput,
            ): Promise<RefreshResult> => {
              requests++;
              if (holdRefresh)
                await new Promise<void>((resolve) => {
                  finishRefresh = resolve;
                });
              if (unavailable)
                return {
                  success: false,
                  code: "BAD_GATEWAY",
                  error: "Discord unavailable",
                };
              stored = { ...stored, needsRefresh: false };
              return {
                success: true,
                ...stored,
                image: stored.profile.avatarUrl,
              };
            },
            ...options,
          }),
      },
    },
  },
}));

const { useDiscordProfile } = await import("./useDiscordProfile");
let latest: ReturnType<typeof useDiscordProfile> | undefined;
let renderer: ReactTestRenderer | undefined;
function Harness({ enabled }: { enabled: boolean }) {
  latest = useDiscordProfile("me", enabled);
  return null;
}
function tree(enabled: boolean) {
  return createElement(
    QueryClientProvider,
    { client },
    createElement(Harness, { enabled }),
  );
}
async function settle() {
  for (let i = 0; i < 3; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
}
async function show(enabled: boolean) {
  await act(async () => {
    if (renderer) renderer.update(tree(enabled));
    else renderer = create(tree(enabled));
  });
  await settle();
}

beforeEach(() => {
  requests = 0;
  unavailable = true;
  holdRefresh = false;
  finishRefresh = undefined;
  stored = {
    needsRefresh: true,
    profile: {
      name: "Me",
      username: "me",
      avatarUrl: "saved.png",
      cosmetics: {
        bannerUrl: "saved-banner.png",
        accentColor: null,
        decorationUrl: null,
        guildTag: null,
        nameplateUrl: null,
        badges: [],
        lastSyncedAt: 1,
      },
    },
  };
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  latest = undefined;
  client.clear();
});
afterAll(() => {
  mock.restore();
  Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
});

test("a failed automatic sync keeps saved cosmetics and retries when revisited", async () => {
  await show(true);
  expect(requests).toBe(1);
  expect(latest?.profile.data?.profile.cosmetics?.bannerUrl).toBe(
    "saved-banner.png",
  );
  expect(latest?.refreshError).toBe("Discord unavailable");
  await settle();
  expect(requests).toBe(1);
  await show(false);
  unavailable = false;
  await show(true);
  expect(requests).toBe(2);
  expect(latest?.refreshError).toBeNull();
  expect(latest?.profile.data?.needsRefresh).toBe(false);
});

test("returning while a refresh is pending does not start another request", async () => {
  holdRefresh = true;
  await show(true);
  expect(requests).toBe(1);
  await show(false);
  await show(true);
  expect(requests).toBe(1);
  unavailable = false;
  await act(async () => {
    finishRefresh?.();
  });
  await settle();
  expect(requests).toBe(1);
});
