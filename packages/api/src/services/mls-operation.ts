import { TRPCError } from "@trpc/server";

import { and, eq, gt, isNull } from "@acme/db";
import {
  type MlsConversation,
  MlsKeyPackage,
  MlsOperation,
} from "@acme/db/schema";

import {
  conversationRoster,
  conversationUsers,
  mlsConflict,
  type MlsDatabase,
} from "./mls";

/** Caller authorized the device and conversation and holds a transaction. */
export async function beginMlsOperation(
  tx: MlsDatabase,
  conversation: typeof MlsConversation.$inferSelect,
  input: { deviceId: string; revision: number },
) {
  if (conversation.revision !== input.revision)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The conversation advanced. Sync and retry the send.",
    });
  if (
    conversation.revision > 0 &&
    !conversation.members.some((m) => m.deviceId === input.deviceId)
  )
    mlsConflict(
      "This device must receive a Welcome from an existing conversation member before sending.",
    );
  const desired = await conversationRoster(
    tx,
    await conversationUsers(tx, conversation),
  );
  const operationId = crypto.randomUUID();
  await tx.insert(MlsOperation).values({
    id: operationId,
    conversationId: conversation.id,
    deviceId: input.deviceId,
    baseRevision: input.revision,
    members: desired,
    expiresAt: new Date(Date.now() + 600_000),
  });
  const packages = [];
  for (const device of desired) {
    if (
      device.deviceId === input.deviceId ||
      conversation.members.some((m) => m.deviceId === device.deviceId)
    )
      continue;
    const [key] = await tx
      .select()
      .from(MlsKeyPackage)
      .where(
        and(
          eq(MlsKeyPackage.deviceId, device.deviceId),
          isNull(MlsKeyPackage.operationId),
          gt(MlsKeyPackage.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!key)
      mlsConflict(
        "A member device has no unused encryption keys. Ask them to open whisp, then retry.",
      );
    const claimed = await tx
      .update(MlsKeyPackage)
      .set({ operationId })
      .where(
        and(eq(MlsKeyPackage.id, key.id), isNull(MlsKeyPackage.operationId)),
      )
      .returning();
    if (claimed.length !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "An encryption key was reserved concurrently. Retry the send.",
      });
    packages.push({ ...device, keyPackageId: key.id, data: key.data });
  }
  return { operationId, members: desired, packages };
}
