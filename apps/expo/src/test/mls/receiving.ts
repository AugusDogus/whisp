import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod/v4";

import type { InboxMessage } from "~/components/friends/types";

import {
  state,
  files,
  conversationId,
  messageId,
  NativeTransportError,
  NativeRequestError,
  withEncryptionDevice,
  prepareEncryptionDevice,
  openWhisp,
  readWhispMediaKind,
  retryWhispMediaKind,
  useInboxMediaKinds,
  enqueueNativeSend,
  descriptor,
  message,
  selfConversation,
  gate,
  seedDescriptor,
} from "./fixture";

export function registerReceivingTests() {
  for (const scenario of [
    "arrival",
    "return from send",
    "cancel and return",
    "network recovers",
    "native network recovers",
  ] as const) {
    test(`inbox media types update without refresh after ${scenario}`, async () => {
      await selfConversation();
      await seedDescriptor();
      const blocked = gate();
      let syncAttempts = 0;
      state.syncDescriptors = async () => {
        if (scenario === "native network recovers" && ++syncAttempts <= 3)
          throw new NativeTransportError();
        await blocked.promise;
        return JSON.stringify(state.descriptors);
      };
      if (scenario === "network recovers") {
        let attempts = 0;
        const delivery = state.handlers["mls.delivery"];
        state.handlers["mls.delivery"] = (input) => {
          if (++attempts <= 3) throw new TypeError("Network request failed");
          return delivery?.(input);
        };
      }
      const client = new QueryClient({
        defaultOptions: { queries: { retryDelay: 0 } },
      });
      let result: ReturnType<typeof useInboxMediaKinds> | undefined;
      let renderer: ReactTestRenderer | undefined;
      function Harness({
        inbox,
        enabled,
      }: {
        inbox: InboxMessage[];
        enabled: boolean;
      }) {
        result = useInboxMediaKinds(inbox, enabled);
        return null;
      }
      function render(inbox: InboxMessage[], enabled = true) {
        return createElement(
          QueryClientProvider,
          { client },
          createElement(Harness, { inbox, enabled }),
        );
      }
      try {
        await act(async () => {
          renderer = create(render([]));
        });
        const inbox: InboxMessage[] = [
          {
            ...message,
            createdAt: new Date(),
            groupId: undefined,
            thumbhash: undefined,
          },
        ];
        await act(async () => {
          renderer?.update(render(inbox, scenario !== "return from send"));
        });
        if (scenario === "cancel and return") {
          await act(async () => renderer?.update(render(inbox, false)));
        }
        await act(async () => renderer?.update(render(inbox)));
        expect(result?.mediaKinds.size).toBe(0);
        await act(async () => {
          blocked.release();
          await delay(50);
        });
        expect(result?.mediaKinds.get(message.deliveryId)).toBe("video");
      } finally {
        blocked.release();
        await act(async () => renderer?.unmount());
        client.clear();
      }
    });
  }
  test("metadata keeps retrying transient requests but stops on permanent failures", () => {
    for (const status of [408, 429, 500, 503]) {
      expect(retryWhispMediaKind(10, new NativeRequestError({ status }))).toBe(
        true,
      );
      expect(
        retryWhispMediaKind(
          10,
          new TRPCClientError("Request failed", {
            meta: { response: new Response(null, { status }) },
          }),
        ),
      ).toBe(true);
    }
    for (const status of [400, 401, 403, 404]) {
      expect(retryWhispMediaKind(1, new NativeRequestError({ status }))).toBe(
        false,
      );
      expect(
        retryWhispMediaKind(
          1,
          new TRPCClientError("Request rejected", {
            meta: { response: new Response(null, { status }) },
          }),
        ),
      ).toBe(false);
    }
    expect(retryWhispMediaKind(1, new Error("Invalid media key"))).toBe(false);
  });
  test("inbox metadata resolves photo and video types without consuming the whisp", async () => {
    await selfConversation();
    let downloads = 0;
    let receipts = 0;
    let cleanups = 0;
    state.download = async () => {
      downloads++;
    };
    state.handlers["messages.markRead"] = () => {
      receipts++;
      return { ok: true };
    };
    state.handlers["messages.cleanupIfAllRead"] = () => {
      cleanups++;
      return { ok: true };
    };
    for (const [mimeType, kind] of [
      ["image/jpeg", "photo"],
      ["video/mp4", "video"],
    ] as const) {
      state.descriptors[messageId] = { ...descriptor, mimeType };
      expect(await readWhispMediaKind(message)).toBe(kind);
      expect(state.descriptors[messageId]).toBeDefined();
    }
    expect(downloads).toBe(0);
    expect(receipts).toBe(0);
    expect(cleanups).toBe(0);
    expect([...files.values()]).not.toContain("plaintext");
    // Metadata sync must leave the descriptor available to the actual viewer.
    const opened = await openWhisp(message);
    expect(opened.mimeType).toBe("video/mp4");
    expect(state.disposedDownloads).toBe(1);
    await opened.dispose();
    expect(receipts).toBe(0);
  });
  test("a failed encrypted download releases native progress subscriptions", async () => {
    await selfConversation();
    await seedDescriptor();
    state.download = async () => {
      throw new Error("Download interrupted");
    };
    await expect(openWhisp(message)).rejects.toThrow("Download interrupted");
    expect(state.disposedDownloads).toBe(1);
    expect([...files.values()]).not.toContain("plaintext");
  });
  test("inbox metadata rejects missing and mismatched encrypted descriptors", async () => {
    await selfConversation();
    await expect(readWhispMediaKind(message)).rejects.toThrow(
      "no valid media key",
    );
    for (const changed of [
      { senderId: "mallory" },
      { groupId: "other-group" },
      { messageId: crypto.randomUUID() },
    ]) {
      state.descriptors[messageId] = { ...descriptor, ...changed };
      await expect(readWhispMediaKind(message)).rejects.toThrow(
        "does not match",
      );
    }
    state.handlers["mls.delivery"] = () => ({ kind: "legacy" });
    await expect(readWhispMediaKind(message)).rejects.toThrow(
      "missing its delivery keys",
    );
  });
  test("opening authenticated cached metadata only requests delivery authorization", async () => {
    await selfConversation();
    await seedDescriptor();
    expect(await readWhispMediaKind(message)).toBe("video");
    expect(state.nativeSyncs).toBe(1);
    // Native storage retains authenticated descriptors after syncing metadata.
    state.cachedDescriptors = { ...state.descriptors };
    state.sessionReads = 0;
    state.apiCalls = [];
    const opened = await openWhisp(message);
    expect(opened.mimeType).toBe("video/mp4");
    expect(state.apiCalls).toEqual(["mls.delivery"]);
    expect(state.sessionReads).toBe(1);
    expect(state.nativeSyncs).toBe(1);
    await opened.dispose();
  });
  test("concurrent metadata reads share device loading but authorize every delivery", async () => {
    await selfConversation();
    const messages = Array.from({ length: 3 }, () => {
      const id = crypto.randomUUID();
      state.descriptors[id] = { ...descriptor, messageId: id };
      return { ...message, messageId: id, deliveryId: crypto.randomUUID() };
    });
    state.handlers["mls.delivery"] = (input) => {
      const { deliveryId } = z.object({ deliveryId: z.string() }).parse(input);
      const current = messages.find((item) => item.deliveryId === deliveryId);
      if (!current) throw new Error("Missing test delivery");
      return {
        kind: "mls",
        messageId: current.messageId,
        conversationId,
        groupId: null,
      };
    };
    state.sessionReads = 0;
    state.apiCalls = [];
    expect(
      await Promise.all(messages.map((item) => readWhispMediaKind(item))),
    ).toEqual(["video", "video", "video"]);
    expect(state.sessionReads).toBe(1);
    expect(state.apiCalls).toEqual([
      "mls.delivery",
      "mls.delivery",
      "mls.delivery",
    ]);
  });
  test("cached metadata never bypasses fresh delivery authorization", async () => {
    await selfConversation();
    state.cachedDescriptors[messageId] = descriptor;
    state.handlers["mls.delivery"] = () => {
      throw new Error("This whisp has already been viewed on your account.");
    };
    let downloads = 0;
    state.download = async () => {
      downloads++;
    };
    await expect(openWhisp(message)).rejects.toThrow("already been viewed");
    expect(downloads).toBe(0);
    expect(state.nativeSyncs).toBe(0);
  });
  test("delivery authorization binds the exact message before cached descriptor reuse", async () => {
    await selfConversation();
    state.cachedDescriptors[messageId] = descriptor;
    let downloads = 0;
    state.download = async () => {
      downloads++;
    };
    for (const authorizedMessageId of [crypto.randomUUID(), undefined]) {
      state.handlers["mls.delivery"] = () => ({
        kind: "mls",
        messageId: authorizedMessageId,
        conversationId,
        groupId: null,
      });
      await expect(openWhisp(message)).rejects.toThrow(
        "does not match this delivery",
      );
    }
    expect(downloads).toBe(0);
    expect(state.nativeSyncs).toBe(0);
  });
  test("cached descriptors retain sender, message, and group validation", async () => {
    await selfConversation();
    for (const changed of [
      { senderId: "mallory" },
      { messageId: crypto.randomUUID() },
      { groupId: "another-group" },
    ]) {
      state.cachedDescriptors[messageId] = { ...descriptor, ...changed };
      await expect(readWhispMediaKind(message)).rejects.toThrow(
        "does not match",
      );
    }
    expect(state.nativeSyncs).toBe(0);
  });
  test("pending delivery authorization does not block private-state operations", async () => {
    await selfConversation();
    await seedDescriptor();
    const entered = gate();
    const blocked = gate();
    state.handlers["mls.delivery"] = async () => {
      entered.release();
      await blocked.promise;
      return { kind: "mls", messageId, conversationId, groupId: null };
    };
    const reading = readWhispMediaKind(message);
    await entered.promise;
    try {
      expect(
        await Promise.race([
          withEncryptionDevice(async () => "available"),
          delay(100).then(() => "blocked"),
        ]),
      ).toBe("available");
    } finally {
      blocked.release();
      await reading;
    }
  });
  test("pending read receipts do not block private-state operations", async () => {
    await selfConversation();
    await seedDescriptor();
    const opened = await openWhisp(message);
    const entered = gate();
    const blocked = gate();
    state.handlers["messages.markRead"] = async () => {
      entered.release();
      await blocked.promise;
      return { ok: true };
    };
    const receipt = opened.acknowledge();
    await entered.promise;
    try {
      expect(
        await Promise.race([
          withEncryptionDevice(async () => "available"),
          delay(100).then(() => "blocked"),
        ]),
      ).toBe("available");
    } finally {
      blocked.release();
      await receipt;
      await opened.dispose();
    }
  });
  test("canceled inbox metadata does not provision or query a device", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readWhispMediaKind(message, controller.signal),
    ).rejects.toThrow("canceled");
    expect(files.size).toBe(0);
  });
  test("switching accounts during metadata sync discards the decrypted type", async () => {
    await selfConversation();
    await seedDescriptor();
    const entered = gate();
    const blocked = gate();
    state.syncDescriptors = async () => {
      entered.release();
      await blocked.promise;
      return JSON.stringify(state.descriptors);
    };
    const reading = readWhispMediaKind(message);
    await entered.promise;
    state.userId = "bob";
    blocked.release();
    await expect(reading).rejects.toThrow(
      "account or encryption device changed",
    );
  });
  test("native enqueue does not hold the foreground device lock", async () => {
    await selfConversation();
    const entered = gate();
    const blocked = gate();
    state.nativeEnqueue = async () => {
      entered.release();
      await blocked.promise;
      return messageId;
    };
    const sending = enqueueNativeSend({
      uri: "file:///source.mp4",
      type: "video",
      recipients: ["alice"],
    });
    await entered.promise;
    try {
      expect(
        await Promise.race([
          withEncryptionDevice(async () => "available"),
          delay(100).then(() => "blocked"),
        ]),
      ).toBe("available");
    } finally {
      blocked.release();
      await sending;
    }
  });
  test("a pending download does not block another viewer's read receipt", async () => {
    await selfConversation();
    await seedDescriptor();
    const first = await openWhisp(message);
    const entered = gate();
    const blocked = gate();
    state.download = async () => {
      entered.release();
      await blocked.promise;
    };
    const opening = openWhisp(message);
    await entered.promise;
    try {
      expect(
        await Promise.race([
          first.acknowledge().then(() => "read"),
          delay(100).then(() => "blocked"),
        ]),
      ).toBe("read");
    } finally {
      blocked.release();
      await (await opening).dispose();
      await first.dispose();
    }
  });
  for (const change of ["account", "device"] as const) {
    test(`changing ${change} during download discards plaintext and does not mark it read`, async () => {
      const original = await selfConversation();
      await seedDescriptor();
      const entered = gate();
      const blocked = gate();
      state.download = async () => {
        entered.release();
        await blocked.promise;
      };
      let receipts = 0;
      state.handlers["messages.markRead"] = () => {
        receipts++;
        return { ok: true };
      };
      const opening = openWhisp(message);
      await entered.promise;
      if (change === "account") state.userId = "bob";
      else
        files.set(
          `${original.root}device.json`,
          JSON.stringify({ deviceId: crypto.randomUUID() }),
        );
      blocked.release();
      await expect(opening).rejects.toThrow(
        "account or encryption device changed",
      );
      expect(receipts).toBe(0);
      expect([...files.values()]).not.toContain("plaintext");
    });
  }
  test("legacy close waits for the read receipt before one remote cleanup", async () => {
    await selfConversation();
    state.handlers["mls.delivery"] = () => ({ kind: "legacy" });
    const blocked = gate();
    const entered = gate();
    let cleanups = 0;
    state.handlers["messages.markRead"] = async () => {
      entered.release();
      await blocked.promise;
      return { ok: true };
    };
    state.handlers["messages.cleanupIfAllRead"] = () => {
      cleanups++;
      return { ok: true };
    };
    const opened = await openWhisp({ ...message, mimeType: "video/quicktime" });
    const receipt = opened.acknowledge();
    await entered.promise;
    const disposal = opened.dispose();
    expect(cleanups).toBe(0);
    blocked.release();
    await Promise.all([receipt, disposal, opened.dispose()]);
    expect(cleanups).toBe(1);
    expect(opened.mimeType).toBe("video/quicktime");
  });
  test("opening does not wait for key maintenance after offline provisioning failed", async () => {
    await selfConversation();
    state.handlers["mls.inventory"] = () => {
      throw new Error("offline");
    };
    await expect(prepareEncryptionDevice()).rejects.toThrow("offline");
    let published = 0;
    state.handlers["mls.inventory"] = () => [];
    state.handlers["mls.publish"] = (input) => {
      const parsed = z
        .object({ packages: z.array(z.object({ id: z.string() })) })
        .parse(input);
      published += parsed.packages.length;
      for (const key of parsed.packages) {
        expect(
          [...files.keys()].some((path) =>
            path.endsWith(`/packages/${key.id}.age`),
          ),
        ).toBe(true);
      }
      return { ok: true };
    };
    await seedDescriptor();
    state.apiCalls = [];
    const opened = await openWhisp(message);
    expect(published).toBe(0);
    expect(state.apiCalls).toEqual(["mls.delivery"]);
    await opened.dispose();
    // App lifecycle retries maintenance independently, preserving publish ordering.
    await prepareEncryptionDevice();
    expect(published).toBe(32);
  });
}
