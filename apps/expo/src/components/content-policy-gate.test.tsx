import { useEffect, type ReactNode } from "react";
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
import { ContentPolicyGate } from "./content-policy-gate";

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
  appContent: ReactNode = <Button>Account settings</Button>,
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
        <ContentPolicyGate>{appContent}</ContentPolicyGate>
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

test("sharing screens remain hidden until the server saves the current terms version", async () => {
  const state = await show("acceptance_required", true);
  expect(JSON.stringify(renderer?.toJSON())).not.toContain("Account settings");
  await act(async () => button("Agree and continue").props.onPress());
  await settle();
  expect(state.accepted).toEqual([{ version: CONTENT_POLICY_VERSION }]);
  expect(JSON.stringify(renderer?.toJSON())).toContain(
    "Could not save acceptance",
  );
  expect(JSON.stringify(renderer?.toJSON())).not.toContain("Account settings");
  state.fail = false;
  await act(async () => button("Agree and continue").props.onPress());
  await settle();
  expect(JSON.stringify(renderer?.toJSON())).toContain("Account settings");
});

test("suspended accounts retain access to their account settings and appeal contact", async () => {
  await show("suspended");
  expect(JSON.stringify(renderer?.toJSON())).toContain("Account settings");
  expect(JSON.stringify(renderer?.toJSON())).toContain("augie@luebbers.email");
});

test("a failed background status refresh preserves the mounted app", async () => {
  let mounts = 0;
  let unmounts = 0;
  function AppState() {
    useEffect(() => {
      mounts++;
      return () => {
        unmounts++;
      };
    }, []);
    return <Button>Account settings</Button>;
  }
  const state = await show("allowed", false, <AppState />);
  expect(mounts).toBe(1);
  state.failStatus = true;
  await act(async () => client.refetchQueries());
  await settle();
  expect(JSON.stringify(renderer?.toJSON())).toContain("Account settings");
  expect(unmounts).toBe(0);
  state.failStatus = false;
  await act(async () => client.refetchQueries());
  await settle();
  expect(mounts).toBe(1);
});
