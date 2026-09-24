import type { SendJob } from "../../utils/native-send";

import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import { getOutboxStatusSnapshot } from "../../utils/outbox-status";
import {
  state,
  messageId,
  notices,
  openWhisp,
  useInboxMediaKinds,
  reconcileNativeSends,
  uploadMedia,
  message,
  gate,
} from "./fixture";

function queuedSend(
  status: SendJob["status"],
  error: string | null,
): SendJob & {
  recipients: [string];
} {
  return {
    id: crypto.randomUUID(),
    kind: "photo",
    recipients: [crypto.randomUUID()],
    groupId: null,
    status,
    error,
    createdAt: Date.now(),
  };
}

export function registerOutboxTests() {
  test("interrupted sends stay pending until automatic recovery reports delivery", async () => {
    const client = new QueryClient();
    const job = queuedSend("uploading", "Connection lost. whisp will retry.");
    state.nativeJobs = [job];
    await reconcileNativeSends(client);
    expect(getOutboxStatusSnapshot(client)[job.recipients[0]]?.state).toBe(
      "retrying",
    );
    expect(notices.error).toEqual([]);
    expect(state.acknowledgedJobs).toEqual([]);
    state.nativeJobs = [{ ...job, status: "sent", error: null }];
    await reconcileNativeSends(client);
    expect(getOutboxStatusSnapshot(client)[job.recipients[0]]?.state).toBe(
      "sent",
    );
    expect(state.acknowledgedJobs).toEqual([job.id]);
    client.clear();
  });
  test("blocked sends stay paused and keep their recovery reason", async () => {
    const client = new QueryClient();
    const reason =
      "Ask the recipient to open whisp, then reopen whisp to retry.";
    const job = queuedSend("blocked", reason);
    state.nativeJobs = [job];
    await reconcileNativeSends(client);
    await reconcileNativeSends(client);
    expect(getOutboxStatusSnapshot(client)[job.recipients[0]]?.state).toBe(
      "blocked",
    );
    expect(notices.info).toEqual([reason]);
    expect(notices.error).toEqual([]);
    expect(state.acknowledgedJobs).toEqual([]);
    client.clear();
  });
  test("terminal send failures are reported and acknowledged", async () => {
    const client = new QueryClient();
    const reason = "The whisp expired. Capture it again.";
    const job = queuedSend("failed", reason);
    state.nativeJobs = [job];
    await reconcileNativeSends(client);
    expect(getOutboxStatusSnapshot(client)[job.recipients[0]]?.state).toBe(
      "failed",
    );
    expect(notices.error).toEqual([reason]);
    expect(state.acknowledgedJobs).toEqual([job.id]);
    client.clear();
  });
  test("changing accounts during native acknowledgement stops remaining job side effects", async () => {
    const client = new QueryClient();
    const first = queuedSend("sent", null);
    const second = queuedSend("failed", "Failure for previous account");
    const pending = queuedSend("uploading", null);
    state.nativeJobs = [first, second, pending];
    state.onAcknowledge = () => {
      state.userId = "bob";
    };
    await reconcileNativeSends(client);
    expect(state.acknowledgedJobs).toEqual([first.id]);
    expect(notices.error).toEqual([]);
    expect(
      getOutboxStatusSnapshot(client)[pending.recipients[0]],
    ).toBeUndefined();
    client.clear();
  });
  for (const kind of ["photo", "video"] as const) {
    for (const source of ["enqueue", "recovery"] as const) {
      test(`${source} self-${kind} has its correct type on the first inbox render`, async () => {
        const client = new QueryClient();
        let renderer: ReactTestRenderer | undefined;
        const renders: (string | undefined)[] = [];
        function Harness() {
          const { mediaKinds } = useInboxMediaKinds(
            [
              {
                ...message,
                groupId: undefined,
                thumbhash: undefined,
                createdAt: new Date(),
              },
            ],
            true,
          );
          renders.push(mediaKinds.get(message.deliveryId));
          return null;
        }
        try {
          if (source === "enqueue") {
            await uploadMedia({
              queryClient: client,
              uri: "file:///source",
              type: kind,
              recipients: ["alice"],
            });
          } else {
            state.nativeJobs = [
              {
                ...queuedSend("sent", null),
                id: messageId,
                kind,
                recipients: ["alice"],
              },
            ];
            await reconcileNativeSends(client);
          }
          state.apiCalls = [];
          await act(async () => {
            renderer = create(
              createElement(
                QueryClientProvider,
                { client },
                createElement(Harness),
              ),
            );
          });
          expect(renders.length).toBeGreaterThan(0);
          expect(renders.every((value) => value === kind)).toBe(true);
          expect(state.apiCalls).toEqual([]);
          // Knowing a sent type must not authorize opening or acknowledge a view.
          state.handlers["mls.delivery"] = () => {
            throw new Error("Delivery already read");
          };
          await expect(openWhisp(message)).rejects.toThrow(
            "Delivery already read",
          );
          expect(state.apiCalls).not.toContain("messages.markRead");
          expect(
            new QueryClient().getQueryData(["whisp-media-kind", messageId]),
          ).toBeUndefined();
        } finally {
          await act(async () => renderer?.unmount());
          client.clear();
        }
      });
    }
  }
  test("send completion waits for inbox refresh before clearing pending feedback", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = [["messages", "inbox"]];
    const job = queuedSend("uploading", null);
    state.nativeJobs = [job];
    await reconcileNativeSends(client);
    const entered = gate();
    const release = gate();
    let refreshing = false;
    await client.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        if (!refreshing) return [];
        entered.release();
        await release.promise;
        return [message];
      },
    });
    refreshing = true;
    state.nativeJobs = [{ ...job, status: "sent" }];
    const completion = reconcileNativeSends(client);
    try {
      await Promise.race([entered.promise, delay(50)]);
      expect(getOutboxStatusSnapshot(client)[job.recipients[0]]?.state).toBe(
        "uploading",
      );
      expect(state.acknowledgedJobs).toEqual([]);
    } finally {
      release.release();
      await completion;
    }
    expect(client.getQueryData<(typeof message)[]>(key)).toEqual([message]);
    expect(getOutboxStatusSnapshot(client)[job.recipients[0]]?.state).toBe(
      "sent",
    );
    expect(state.acknowledgedJobs).toEqual([job.id]);
    client.clear();
  });
  for (const scenario of ["refresh failure", "account switch"] as const) {
    test(`${scenario} does not acknowledge or clear pending sends`, async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const job = queuedSend("uploading", null);
      state.nativeJobs = [job];
      await reconcileNativeSends(client);
      let refreshing = false;
      let fail = true;
      await client.fetchQuery({
        queryKey: [["messages", "inbox"]],
        queryFn: async () => {
          if (refreshing) {
            if (scenario === "account switch") state.userId = "bob";
            else if (fail) throw new Error("Inbox unavailable");
          }
          return [];
        },
      });
      refreshing = true;
      state.nativeJobs = [{ ...job, status: "sent" }];
      try {
        if (scenario === "refresh failure")
          await expect(reconcileNativeSends(client)).rejects.toThrow(
            "Inbox unavailable",
          );
        else await reconcileNativeSends(client);
        expect(state.acknowledgedJobs).toEqual([]);
        expect(getOutboxStatusSnapshot(client)[job.recipients[0]]?.state).toBe(
          "uploading",
        );
        expect(notices.success).toEqual([]);
        if (scenario === "refresh failure") {
          fail = false;
          await reconcileNativeSends(client);
          expect(state.acknowledgedJobs).toEqual([job.id]);
          expect(
            getOutboxStatusSnapshot(client)[job.recipients[0]]?.state,
          ).toBe("sent");
        }
      } finally {
        client.clear();
      }
    });
  }
}
