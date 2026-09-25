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
import { TermsAcceptance } from "./terms-acceptance";

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
) {
  const state: {
    status: "acceptance_required" | "suspended" | "allowed";
    fail: boolean;
    failStatus: boolean;
    accepted: unknown[];
  } = { status: initial, fail, failStatus: false, accepted: [] };
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
        <TermsAcceptance />
        <Button>Delete account</Button>
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

test("terms require explicit acceptance, and failed submissions can be retried", async () => {
  const state = await show("acceptance_required", true);
  expect(state.accepted).toEqual([]);
  expect(JSON.stringify(renderer?.toJSON())).toContain(
    "Accept the Terms of Service",
  );
  await act(async () => button("Accept terms").props.onPress());
  await settle();
  expect(state.accepted).toEqual([{ version: CONTENT_POLICY_VERSION }]);
  expect(JSON.stringify(renderer?.toJSON())).toContain(
    "Could not save acceptance",
  );
  expect(JSON.stringify(renderer?.toJSON())).toContain("Delete account");
  state.fail = false;
  await act(async () => button("Accept terms").props.onPress());
  await settle();
  expect(JSON.stringify(renderer?.toJSON())).not.toContain(
    "Accept the Terms of Service",
  );
  expect(JSON.stringify(renderer?.toJSON())).toContain("Delete account");
});

test.each(["allowed", "suspended"] as const)(
  "%s accounts have no acceptance prompt",
  async (status) => {
    const state = await show(status);
    expect(JSON.stringify(renderer?.toJSON())).not.toContain("Accept terms");
    expect(state.accepted).toEqual([]);
    expect(JSON.stringify(renderer?.toJSON())).toContain("Delete account");
  },
);

test("acceptance can be ignored without hiding account controls", async () => {
  const state = await show("acceptance_required");
  expect(JSON.stringify(renderer?.toJSON())).toContain("Delete account");
  expect(state.accepted).toEqual([]);
});

test("failed status refresh exposes a retry without hiding account controls", async () => {
  const state = await show("acceptance_required");
  state.failStatus = true;
  await act(async () => client.refetchQueries());
  await settle();
  expect(JSON.stringify(renderer?.toJSON())).toContain(
    "Could not check terms acceptance",
  );
  expect(JSON.stringify(renderer?.toJSON())).toContain("Delete account");
  state.failStatus = false;
  await act(async () => button("Try again").props.onPress());
  await settle();
  expect(JSON.stringify(renderer?.toJSON())).not.toContain(
    "Could not check terms acceptance",
  );
  expect(state.accepted).toEqual([]);
});
