import { z } from "zod/v4";

import { and, eq, isNull } from "@acme/db";
import { MlsDevice } from "@acme/db/schema";

import { mlsConflict, type MlsDatabase } from "./mls";

export const signatureKey = z
  .string()
  .length(44)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine(
    (value) => Buffer.from(value, "base64").length === 32,
    "Expected an Ed25519 public key",
  );

/** Caller holds a transaction, including any draft preparation. */
export async function registerMlsDevice(
  tx: MlsDatabase,
  userId: string,
  input: { deviceId: string; signatureKey: string; name?: string },
) {
  const [existing] = await tx
    .select()
    .from(MlsDevice)
    .where(eq(MlsDevice.id, input.deviceId));
  if (existing) {
    if (
      existing.userId !== userId ||
      existing.signatureKey !== input.signatureKey ||
      existing.revokedAt
    )
      mlsConflict(
        "This device identity cannot be replaced. Register a new encryption device.",
      );
    if (input.name !== undefined && input.name !== existing.name)
      await tx
        .update(MlsDevice)
        .set({ name: input.name })
        .where(eq(MlsDevice.id, input.deviceId));
    return;
  }
  const devices = await tx
    .select()
    .from(MlsDevice)
    .where(and(eq(MlsDevice.userId, userId), isNull(MlsDevice.revokedAt)));
  if (devices.length >= 10)
    mlsConflict(
      "Ten encryption devices are registered. Remove a lost or unused device before adding another.",
    );
  await tx.insert(MlsDevice).values({
    id: input.deviceId,
    userId,
    signatureKey: input.signatureKey,
    name: input.name,
    createdAt: new Date(),
  });
}
