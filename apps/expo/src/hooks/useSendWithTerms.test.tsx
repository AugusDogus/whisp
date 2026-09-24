import { useState, type ReactNode } from "react";
import { Modal } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { BaseNavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Button } from "heroui-native/button";

import { CONTENT_POLICY_VERSION } from "@acme/validators";

import { trpc } from "~/utils/api";

import { ContentPolicyScreen } from "../components/content-policy-screen";
import { settle } from "../test/discord-profile";
import { native } from "../test/setup";
import { useSendWithTerms } from "./useSendWithTerms";

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
  mode: "send" | "onboarding" = "send",
) {
  const state: {
    status: "acceptance_required" | "suspended" | "allowed";
    fail: boolean;
    failStatus: boolean;
    accepted: unknown[];
    sent: number;
    continued: number;
    afterAccept: "allowed" | "suspended";
    hold: Promise<void> | undefined;
  } = {
    status: initial,
    fail,
    failStatus: false,
    accepted: [],
    sent: 0,
    continued: 0,
    afterAccept: "allowed",
    hold: undefined,
  };
  const api = trpc.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            async function respond() {
              if (op.path === "safety.status" && state.failStatus) {
                observer.error(
                  TRPCClientError.from(new Error("Network unavailable")),
                );
                return;
              }
              if (op.path === "safety.acceptPolicy") {
                state.accepted.push(op.input);
                if (state.hold) await state.hold;
                if (state.fail) {
                  observer.error(
                    TRPCClientError.from(
                      new Error("Could not save acceptance"),
                    ),
                  );
                  return;
                }
                state.status = state.afterAccept;
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
            }
            void respond();
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
  function SendScreen() {
    const { confirmSend, dialog } = useSendWithTerms();
    const [draft, setDraft] = useState("Photo and recipients");
    return (
      <>
        {dialog}
        <Button
          onPress={async () => {
            if (!(await confirmSend())) return;
            state.sent++;
            setDraft("Sent");
          }}
        >
          Send
        </Button>
        <Button>{draft}</Button>
      </>
    );
  }
  const onContinue = () => {
    state.continued++;
  };
  await act(async () => {
    renderer = create(
      <Provider>
        <BaseNavigationContainer>
          {mode === "send" ? (
            <SendScreen />
          ) : (
            <ContentPolicyScreen onContinue={onContinue} />
          )}
        </BaseNavigationContainer>
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
    .find(
      (node) =>
        node.props.children === label ||
        node
          .findAllByType(Button.Label)
          .some((child) => child.props.children === label),
    );
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

async function press(label: string) {
  // Send intentionally waits for the dialog, so do not await its handler here.
  await act(async () => {
    void button(label).props.onPress();
  });
  await settle();
}
function screen() {
  return JSON.stringify(renderer?.toJSON());
}

test("skipped terms prompt on send and accepting resumes exactly once", async () => {
  const state = await show("acceptance_required");
  expect(screen()).not.toContain("Accept terms to send");
  await press("Send");
  await press("Send");
  expect(state.sent).toBe(0);
  expect(screen()).toContain("Photo and recipients");
  expect(screen()).toContain("Accept terms to send");
  await press("Accept and send");
  expect(state.accepted).toEqual([{ version: CONTENT_POLICY_VERSION }]);
  expect(state.sent).toBe(1);
  expect(screen()).not.toContain("Accept terms to send");
});

test("dismissing keeps the draft and requires a new Send tap", async () => {
  const state = await show("acceptance_required");
  await press("Send");
  await press("Cancel");
  expect(state.sent).toBe(0);
  expect(state.accepted).toEqual([]);
  expect(screen()).toContain("Photo and recipients");
  await press("Send");
  expect(screen()).toContain("Accept terms to send");
  await act(async () =>
    renderer?.root.findByType(Modal).props.onRequestClose(),
  );
  expect(state.sent).toBe(0);
  expect(screen()).not.toContain("Accept terms to send");
});

test("failed acceptance preserves draft and retries without sending early", async () => {
  const state = await show("acceptance_required", true);
  await press("Send");
  await press("Accept and send");
  expect(screen()).toContain("Could not save acceptance");
  expect(state.sent).toBe(0);
  state.fail = false;
  await press("Accept and send");
  expect(state.sent).toBe(1);
});

test("already accepted sends without a modal, but a later policy change prompts", async () => {
  const state = await show("allowed");
  await press("Send");
  expect(state.sent).toBe(1);
  expect(screen()).not.toContain("Accept terms to send");
  state.status = "acceptance_required";
  await press("Send");
  expect(state.sent).toBe(1);
  expect(screen()).toContain("Accept terms to send");
});

test("permission check failures and suspensions never send", async () => {
  const state = await show("suspended");
  await press("Send");
  expect(state.sent).toBe(0);
  expect(screen()).toContain("Sharing is suspended");
  await press("Cancel");
  state.failStatus = true;
  await press("Send");
  expect(screen()).toContain("Could not check sharing permissions");
  state.failStatus = false;
  state.status = "allowed";
  await press("Try again");
  expect(state.sent).toBe(1);
});

test("a suspension during acceptance stops the pending send", async () => {
  const state = await show("acceptance_required");
  state.afterAccept = "suspended";
  await press("Send");
  await press("Accept and send");
  expect(state.sent).toBe(0);
  expect(screen()).toContain("Sharing is suspended");
});

test.each(["dismiss", "unmount"])(
  "%s during acceptance prevents a late send",
  async (action) => {
    const state = await show("acceptance_required");
    const held = Promise.withResolvers<void>();
    state.hold = held.promise;
    await press("Send");
    await press("Accept and send");
    if (action === "dismiss") await press("Cancel");
    else await act(async () => renderer?.unmount());
    held.resolve();
    await settle();
    expect(state.sent).toBe(0);
  },
);

test("onboarding can be skipped without acceptance", async () => {
  const state = await show("acceptance_required", false, "onboarding");
  await press("Not now");
  expect(state.continued).toBe(1);
  expect(state.accepted).toEqual([]);
});

test("onboarding acceptance advances and accepted accounts skip it", async () => {
  const state = await show("acceptance_required", false, "onboarding");
  await press("Agree and continue");
  expect(state.continued).toBe(1);
  expect(state.accepted).toEqual([{ version: CONTENT_POLICY_VERSION }]);
});
