import { expect, test } from "bun:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  state,
  files,
  signatureKey,
  withEncryptionDevice,
  prepareEncryptionDevice,
  resetEncryptionDevice,
  gate,
} from "./fixture";

export function registerDeviceTests() {
  test("device provisioning registers the phone model without personal device names", async () => {
    const registrations: unknown[] = [];
    state.handlers["mls.register"] = (input) => {
      registrations.push(input);
      return { ok: true };
    };
    await prepareEncryptionDevice();
    expect(registrations).toHaveLength(1);
    expect(registrations[0]).toMatchObject({
      name: "Pixel 8 Pro",
      signatureKey,
    });
  });
  for (const operation of [
    "mls.register",
    "mls.inventory",
    "mls.publish",
  ] as const) {
    test(`key maintenance releases the private-state lease during ${operation}`, async () => {
      const blocked = gate();
      const entered = gate();
      state.handlers["mls.inventory"] = () => [];
      state.handlers["mls.publish"] = () => ({ ok: true });
      const original = state.handlers[operation];
      state.handlers[operation] = async (input) => {
        entered.release();
        await blocked.promise;
        return original?.(input);
      };
      const preparing = prepareEncryptionDevice();
      expect(prepareEncryptionDevice()).toBe(preparing);
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
        await preparing;
      }
      expect(state.apiCalls.filter((path) => path === operation)).toHaveLength(
        1,
      );
    });
  }
  for (const change of ["account", "device"] as const) {
    test(`key maintenance does not publish after changing ${change}`, async () => {
      const device = await withEncryptionDevice(async (current) => current);
      const blocked = gate();
      const entered = gate();
      state.handlers["mls.inventory"] = async () => {
        entered.release();
        await blocked.promise;
        return [];
      };
      const preparing = prepareEncryptionDevice();
      await entered.promise;
      if (change === "account") state.userId = "bob";
      else
        files.set(
          `${device.root}device.json`,
          JSON.stringify({ deviceId: crypto.randomUUID() }),
        );
      blocked.release();
      await expect(preparing).rejects.toThrow(
        "account or encryption device changed",
      );
      expect(state.apiCalls).not.toContain("mls.publish");
    });
  }
  test("reset provisions a new device without reusing interrupted maintenance", async () => {
    const device = await withEncryptionDevice(async (current) => current);
    const entered = gate();
    const blocked = gate();
    let calls = 0;
    state.handlers["mls.inventory"] = async () => {
      if (++calls === 1) {
        entered.release();
        await blocked.promise;
      }
      return Array.from({ length: 32 }, () => crypto.randomUUID());
    };
    state.handlers["mls.revoke"] = () => ({ ok: true });
    const preparing = prepareEncryptionDevice();
    const failed = preparing.then(
      () => null,
      (error: unknown) => error,
    );
    await entered.promise;
    try {
      await resetEncryptionDevice();
      const current = await withEncryptionDevice(async (value) => value);
      expect(current.deviceId).not.toBe(device.deviceId);
      expect(calls).toBe(2);
    } finally {
      blocked.release();
      expect(await failed).toBeInstanceOf(Error);
    }
  });
}
