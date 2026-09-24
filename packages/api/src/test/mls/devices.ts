import { expect, test } from "bun:test";

import { sender, outsider, senderDevice, signatureKey } from "./fixture";

export function registerDeviceTests() {
  test("new devices store a bounded model name", async () => {
    const deviceId = crypto.randomUUID();
    await sender.register({ deviceId, signatureKey, name: "  Pixel 8 Pro  " });
    expect(
      (await sender.devices()).find((device) => device.id === deviceId),
    ).toMatchObject({ name: "Pixel 8 Pro" });
    for (const name of [" ", "x".repeat(101)]) {
      await expect(
        sender.register({ deviceId, signatureKey, name }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  test("device names update without replacing keys and survive older clients", async () => {
    await sender.register({
      deviceId: senderDevice,
      signatureKey,
      name: "Pixel 8 Pro",
    });
    expect(await sender.devices()).toMatchObject([
      { name: "Pixel 8 Pro", signatureKey },
    ]);
    await sender.register({ deviceId: senderDevice, signatureKey });
    expect(await sender.devices()).toMatchObject([{ name: "Pixel 8 Pro" }]);
    await expect(
      outsider.register({
        deviceId: senderDevice,
        signatureKey,
        name: "Other phone",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await sender.devices()).toMatchObject([{ name: "Pixel 8 Pro" }]);
    await sender.register({
      deviceId: senderDevice,
      signatureKey,
      name: "Pixel 9",
    });
    expect(await sender.devices()).toMatchObject([
      { name: "Pixel 9", signatureKey },
    ]);
  });
}
