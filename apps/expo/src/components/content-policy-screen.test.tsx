import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { trpc } from "~/utils/api";

import { settle } from "../test/discord-profile";
import { native } from "../test/setup";
import { ContentPolicyScreen } from "./content-policy-screen";

let renderer: ReactTestRenderer | undefined;
let client: QueryClient;
beforeEach(() => {
  native.userId = "me";
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

async function show(
  initial: "acceptance_required" | "suspended" | "allowed",
  fail = false,
  mode: "onboarding" | "review" = "onboarding",
) {
  const state: {
    status: "acceptance_required" | "suspended" | "allowed";
    fail: boolean;
    failStatus: boolean;
    accepted: unknown[];
    continued: number;
  } = { status: initial, fail, failStatus: false, accepted: [], continued: 0 };
  const api = trpc.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            if (op.path === "safety.status" && state.failStatus) {
              observer.error(
                TRPCClientError.from(new Error("Network unavailable")),
              );
              return;
            }
            if (op.path === "safety.acceptPolicy") {
              state.accepted.push(op.input);
              if (state.fail) {
                observer.error(
                  TRPCClientError.from(new Error("Could not save acceptance")),
                );
                return;
              }
              state.status = "allowed";
            }
            observer.next({
              result: {
                data:
                  op.path === "safety.status"
                    ? { status: state.status }
                    : { ok: true },
              },
            });
            observer.complete();
          }),
    ],
  });
  function Provider({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <trpc.Provider client={api} queryClient={client}>
          {children}
        </trpc.Provider>
      </QueryClientProvider>
    );
  }
  await act(async () => {
    renderer = create(
      <Provider>
        <ContentPolicyScreen
          mode={mode}
          onContinue={() => {
            state.continued++;
          }}
        />
      </Provider>,
    );
  });
  await settle();
  return state;
}

function button(label: string) {
  const match = renderer?.root
    .findAllByType(Button)
    .find((node) => node.props.children === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

test("onboarding requires explicit acceptance and preserves failed submissions", async () => {
  const state = await show("acceptance_required", true);
  expect(state.continued).toBe(0);
  expect(JSON.stringify(renderer?.toJSON())).toContain("Before you share");
  await act(async () => button("Agree and continue").props.onPress());
  await settle();
  expect(state.accepted).toEqual([{ version: CONTENT_POLICY_VERSION }]);
  expect(state.continued).toBe(0);
  expect(JSON.stringify(renderer?.toJSON())).toContain(
    "Could not save acceptance",
  );
  state.fail = false;
  await act(async () => button("Agree and continue").props.onPress());
  await settle();
  expect(state.continued).toBe(1);
});

test("declining onboarding terms continues without recording acceptance", async () => {
  const state = await show("acceptance_required");
  await act(async () => button("Not now").props.onPress());
  expect(state.accepted).toEqual([]);
  expect(state.continued).toBe(1);
});

test("accounts that already accepted skip the terms during onboarding", async () => {
  const state = await show("allowed");
  expect(state.continued).toBe(1);
  expect(state.accepted).toEqual([]);
  expect(JSON.stringify(renderer?.toJSON())).not.toContain("Before you share");
});

test("suspended accounts can reach their account controls without accepting", async () => {
  const state = await show("suspended");
  expect(state.continued).toBe(1);
  expect(state.accepted).toEqual([]);
});

test("terms can be reopened from Profile and accepted after declining", async () => {
  const state = await show("acceptance_required", false, "review");
  expect(state.continued).toBe(0);
  await act(async () => button("Agree and continue").props.onPress());
  await settle();
  expect(state.continued).toBe(1);
  expect(state.accepted).toEqual([{ version: CONTENT_POLICY_VERSION }]);
});

test("already accepted terms remain readable from Profile without resubmitting", async () => {
  const state = await show("allowed", false, "review");
  expect(state.continued).toBe(0);
  expect(JSON.stringify(renderer?.toJSON())).toContain("Before you share");
  await act(async () => button("Done").props.onPress());
  expect(state.continued).toBe(1);
  expect(state.accepted).toEqual([]);
});

test("a failed terms refresh retains the option to reach account controls", async () => {
  const state = await show("acceptance_required");
  state.failStatus = true;
  await act(async () => client.refetchQueries());
  await settle();
  expect(JSON.stringify(renderer?.toJSON())).toContain(
    "Could not load your terms acceptance",
  );
  await act(async () => button("Not now").props.onPress());
  expect(state.continued).toBe(1);
  expect(state.accepted).toEqual([]);
});
