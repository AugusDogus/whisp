import "./setup";
import type { ReactNode } from "react";
import { act } from "react-test-renderer";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { z } from "zod/v4";

import type { RouterOutputs } from "~/utils/api";
import { trpc } from "~/utils/api";

type Profile = RouterOutputs["auth"]["discordProfile"];
const refreshInput = z.object({
  userId: z.string(),
  mode: z.enum(["force", "if-stale"]).default("force"),
});

export function createProfileFixture() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fixture: {
    stored: Profile;
    unavailable: boolean;
    requests: z.output<typeof refreshInput>[];
    reads: number;
    holdRefresh: boolean;
    finishRefresh: (() => void) | undefined;
  } = {
    stored: {
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
    },
    unavailable: true,
    requests: [],
    reads: 0,
    holdRefresh: false,
    finishRefresh: undefined,
  };
  const client = trpc.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            async function respond() {
              if (op.path === "auth.discordProfile") {
                fixture.reads++;
                return fixture.stored;
              }
              if (op.path !== "auth.refreshAvatar")
                throw new Error(`Unexpected test request: ${op.path}`);
              fixture.requests.push(refreshInput.parse(op.input));
              if (fixture.holdRefresh)
                await new Promise<void>((resolve) => {
                  fixture.finishRefresh = resolve;
                });
              if (fixture.unavailable)
                return {
                  success: false,
                  code: "BAD_GATEWAY",
                  error: "Discord unavailable",
                };
              fixture.stored = { ...fixture.stored, needsRefresh: false };
              return {
                success: true,
                ...fixture.stored,
                image: fixture.stored.profile.avatarUrl,
              };
            }
            void respond().then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error: unknown) =>
                observer.error(
                  TRPCClientError.from(
                    error instanceof Error
                      ? error
                      : new Error("Discord profile test request failed", {
                          cause: error,
                        }),
                  ),
                ),
            );
          }),
    ],
  });
  function Provider({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <trpc.Provider client={client} queryClient={queryClient}>
          {children}
        </trpc.Provider>
      </QueryClientProvider>
    );
  }
  return { state: fixture, queryClient, Provider };
}

export async function settle() {
  for (let i = 0; i < 3; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
}
