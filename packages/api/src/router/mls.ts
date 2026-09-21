import type { TRPCRouterRecord } from "@trpc/server";

import { z } from "zod/v4";

import { and, eq, gt, isNull } from "@acme/db";
import {
  MlsDevice,
  MlsOperation,
  MlsWelcome,
  MlsKeyPackage,
} from "@acme/db/schema";

import { mlsConflict, requireDevice } from "../services/mls";
import { protectedProcedure } from "../trpc";
import { mlsConversationsRouter } from "./mls-conversations";

const id = z.uuid();
const bytes = z
  .string()
  .min(4)
  .max(128 * 1024)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const signatureKey = bytes.refine(
  (value) => Buffer.from(value, "base64").length === 32,
  "Expected an Ed25519 public key",
);

export const mlsRouter = {
  register: protectedProcedure
    .input(
      z.object({
        deviceId: id,
        signatureKey,
        name: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(MlsDevice)
          .where(eq(MlsDevice.id, input.deviceId));
        if (existing) {
          if (
            existing.userId !== ctx.session.user.id ||
            existing.signatureKey !== input.signatureKey ||
            existing.revokedAt
          )
            mlsConflict(
              "This device identity cannot be replaced. Register a new encryption device.",
            );
          if (input.name !== undefined && input.name !== existing.name) {
            await tx
              .update(MlsDevice)
              .set({ name: input.name })
              .where(eq(MlsDevice.id, input.deviceId));
          }
          return;
        }
        const devices = await tx
          .select()
          .from(MlsDevice)
          .where(
            and(
              eq(MlsDevice.userId, ctx.session.user.id),
              isNull(MlsDevice.revokedAt),
            ),
          );
        if (devices.length >= 10)
          mlsConflict(
            "Ten encryption devices are registered. Remove a lost or unused device before adding another.",
          );
        await tx.insert(MlsDevice).values({
          id: input.deviceId,
          userId: ctx.session.user.id,
          signatureKey: input.signatureKey,
          name: input.name,
          createdAt: new Date(),
        });
      });
      return { ok: true };
    }),
  devices: protectedProcedure.query(({ ctx }) =>
    ctx.db
      .select()
      .from(MlsDevice)
      .where(
        and(
          eq(MlsDevice.userId, ctx.session.user.id),
          isNull(MlsDevice.revokedAt),
        ),
      ),
  ),
  revoke: protectedProcedure
    .input(z.object({ deviceId: id }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(MlsDevice)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(MlsDevice.id, input.deviceId),
            eq(MlsDevice.userId, ctx.session.user.id),
          ),
        );
      return { ok: true };
    }),
  inventory: protectedProcedure
    .input(z.object({ deviceId: id }))
    .query(async ({ ctx, input }) => {
      await requireDevice(ctx.db, ctx.session.user.id, input.deviceId);
      const packages = await ctx.db
        .select({ id: MlsKeyPackage.id })
        .from(MlsKeyPackage)
        .where(
          and(
            eq(MlsKeyPackage.deviceId, input.deviceId),
            isNull(MlsKeyPackage.operationId),
            gt(MlsKeyPackage.expiresAt, new Date()),
          ),
        );
      return packages.map((p) => p.id);
    }),
  retainedKeys: protectedProcedure
    .input(z.object({ deviceId: id }))
    .query(async ({ ctx, input }) => {
      await requireDevice(ctx.db, ctx.session.user.id, input.deviceId);
      const rows = await ctx.db
        .select({
          key: MlsKeyPackage,
          operation: MlsOperation,
          welcome: MlsWelcome,
        })
        .from(MlsKeyPackage)
        .leftJoin(MlsOperation, eq(MlsOperation.id, MlsKeyPackage.operationId))
        .leftJoin(MlsWelcome, eq(MlsWelcome.keyPackageId, MlsKeyPackage.id))
        .where(eq(MlsKeyPackage.deviceId, input.deviceId));
      const now = new Date();
      return rows
        .filter(({ key, operation, welcome }) =>
          welcome
            ? !welcome.acknowledgedAt
            : operation
              ? operation.revision === null && operation.expiresAt > now
              : key.expiresAt > now,
        )
        .map(({ key }) => key.id);
    }),
  publish: protectedProcedure
    .input(
      z.object({
        deviceId: id,
        packages: z
          .array(z.object({ id, data: bytes }))
          .min(1)
          .max(32),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.transaction(async (tx) => {
        await requireDevice(tx, ctx.session.user.id, input.deviceId);
        const available = await tx
          .select()
          .from(MlsKeyPackage)
          .where(
            and(
              eq(MlsKeyPackage.deviceId, input.deviceId),
              isNull(MlsKeyPackage.operationId),
              gt(MlsKeyPackage.expiresAt, new Date()),
            ),
          );
        if (available.length + input.packages.length > 64)
          mlsConflict("This device already has enough unused encryption keys.");
        await tx
          .insert(MlsKeyPackage)
          .values(
            input.packages.map((p) => ({
              ...p,
              deviceId: input.deviceId,
              expiresAt: new Date(Date.now() + 30 * 86400_000),
            })),
          )
          .onConflictDoNothing();
      });
      return { ok: true };
    }),
  ...mlsConversationsRouter,
} satisfies TRPCRouterRecord;
