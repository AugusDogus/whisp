import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import { localMediaUri } from "../../utils/media-uri";
import {
  state,
  files,
  messageId,
  enqueueNativeSend,
  configureNativeSends,
  gate,
} from "./fixture";

export function registerNativeSendTests() {
  test("a transient sign-in check failure preserves native worker configuration", async () => {
    await configureNativeSends();
    expect(state.nativeConfigurations).toHaveLength(1);
    state.sessionError = { message: "offline" };
    await expect(configureNativeSends()).rejects.toThrow(
      "Queued sends are preserved",
    );
    expect(state.nativeConfigurations).toHaveLength(1);
  });
  test("signing out clears native configuration even when session lookup fails", async () => {
    await configureNativeSends();
    state.signedOut = true;
    state.sessionError = { message: "offline" };
    await configureNativeSends();
    expect(state.nativeConfigurations.at(-1)).toBeNull();
  });
  test("configuring a native send checks the session only once", async () => {
    await configureNativeSends();
    expect(state.sessionReads).toBe(1);
    expect(state.nativeConfigurations).toHaveLength(1);
  });
  const capturedPhoto = {
    uri: "file:///source.jpg",
    type: "photo",
    recipients: ["alice"],
  } as const;
  function enqueuePhoto() {
    return enqueueNativeSend({
      ...capturedPhoto,
      recipients: [...capturedPhoto.recipients],
    });
  }
  test("iOS camera URLs reach the native queue as decoded filesystem paths", async () => {
    let enqueued: unknown;
    state.nativeEnqueue = async (input) => {
      enqueued = JSON.parse(input);
      return messageId;
    };
    await enqueueNativeSend({
      uri: localMediaUri("file:///private/var/mobile/tmp/photo%20%231.jpg"),
      type: "photo",
      recipients: ["alice"],
    });
    expect(enqueued).toMatchObject({
      source: "/private/var/mobile/tmp/photo #1.jpg",
      kind: "photo",
      recipients: ["alice"],
    });
  });
  test("warm native enqueue reuses configuration without a session lookup", async () => {
    await configureNativeSends();
    state.sessionReads = 0;
    state.nativeConfigurations = [];
    await enqueuePhoto();
    await enqueuePhoto();
    expect(state.sessionReads).toBe(0);
    expect(state.nativeConfigurations).toEqual([]);
  });
  test("native enqueue reconfigures after an account switch", async () => {
    await configureNativeSends();
    state.sessionReads = 0;
    state.nativeConfigurations = [];
    state.userId = "bob";
    await enqueuePhoto();
    expect(state.sessionReads).toBe(1);
    expect(state.nativeConfigurations).toHaveLength(1);
    expect(JSON.parse(state.nativeConfigurations[0] ?? "null")).toMatchObject({
      userId: "bob",
    });
  });
  test("native enqueue reconfigures after the local encryption device changes", async () => {
    await configureNativeSends();
    const deviceId = crypto.randomUUID();
    const manifest = [...files.keys()].find((path) =>
      path.endsWith("device.json"),
    );
    if (!manifest) throw new Error("Test device manifest was not created");
    files.set(manifest, JSON.stringify({ deviceId }));
    state.sessionReads = 0;
    let enqueued: unknown;
    state.nativeEnqueue = async (input) => {
      enqueued = JSON.parse(input);
      return messageId;
    };
    await enqueuePhoto();
    expect(state.sessionReads).toBe(1);
    expect(enqueued).toMatchObject({ deviceId });
  });
  test("native enqueue preserves malformed manifest errors instead of reprovisioning", async () => {
    await configureNativeSends();
    const manifest = [...files.keys()].find((path) =>
      path.endsWith("device.json"),
    );
    if (!manifest) throw new Error("Test device manifest was not created");
    files.set(manifest, "invalid json");
    state.sessionReads = 0;
    await expect(enqueuePhoto()).rejects.toThrow();
    expect(state.sessionReads).toBe(0);
    expect(files.get(manifest)).toBe("invalid json");
  });
  test("native enqueue cannot reuse configuration while an explicit auth refresh expires it", async () => {
    await configureNativeSends();
    state.sessionMissing = true;
    const refreshing = configureNativeSends();
    const sending = enqueuePhoto();
    await refreshing;
    await expect(sending).rejects.toThrow("Sign in before");
    expect(state.nativeConfigurations.at(-1)).toBeNull();
  });
  test("native configuration finishes before a concurrent enqueue uses it", async () => {
    const entered = gate();
    const blocked = gate();
    state.nativeConfigure = async () => {
      entered.release();
      await blocked.promise;
    };
    const configuring = configureNativeSends();
    await entered.promise;
    let enqueued = false;
    state.nativeEnqueue = async () => {
      enqueued = true;
      return messageId;
    };
    const sending = enqueuePhoto();
    await delay(10);
    expect(enqueued).toBe(false);
    blocked.release();
    await configuring;
    await sending;
    expect(state.sessionReads).toBe(1);
    expect(enqueued).toBe(true);
  });
  test("switching accounts during configuration rejects an already queued send", async () => {
    const entered = gate();
    const blocked = gate();
    state.nativeConfigure = async () => {
      entered.release();
      await blocked.promise;
    };
    const configuring = configureNativeSends().catch((error: unknown) => error);
    await entered.promise;
    let enqueued = false;
    state.nativeEnqueue = async () => {
      enqueued = true;
      return messageId;
    };
    const sending = enqueuePhoto().catch((error: unknown) => error);
    state.userId = "bob";
    blocked.release();
    expect(await configuring).toBeInstanceOf(Error);
    expect(await sending).toBeInstanceOf(Error);
    expect(enqueued).toBe(false);
    await configureNativeSends();
    await enqueuePhoto();
    expect(enqueued).toBe(true);
  });
  test("a pending native source copy does not delay sign-out configuration", async () => {
    await configureNativeSends();
    const entered = gate();
    const blocked = gate();
    state.nativeEnqueue = async () => {
      entered.release();
      await blocked.promise;
      return messageId;
    };
    const sending = enqueuePhoto();
    await entered.promise;
    state.signedOut = true;
    try {
      expect(
        await Promise.race([
          configureNativeSends().then(() => "cleared"),
          delay(100).then(() => "blocked"),
        ]),
      ).toBe("cleared");
      expect(state.nativeConfigurations.at(-1)).toBeNull();
    } finally {
      blocked.release();
      await sending;
    }
  });
  test("an expired session clears native configuration without a second lookup", async () => {
    state.sessionMissing = true;
    await configureNativeSends();
    expect(state.sessionReads).toBe(1);
    expect(state.nativeConfigurations).toEqual([null]);
  });
}
