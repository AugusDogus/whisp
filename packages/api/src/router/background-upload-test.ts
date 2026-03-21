import type { TRPCRouterRecord } from "@trpc/server";

import { and, desc, eq } from "drizzle-orm";
import { UTApi } from "uploadthing/server";
import { z } from "zod/v4";

import { BackgroundUploadTestFile } from "@acme/db/schema";

import { protectedProcedure } from "../trpc";

function assertBackgroundUploadTestEnabled() {
  if (process.env.ENABLE_BACKGROUND_UPLOAD_TEST_PAGE !== "true") {
    throw new Error("Background upload test page is disabled.");
  }
}

export const backgroundUploadTestRouter = {
  list: protectedProcedure.query(async ({ ctx }) => {
    assertBackgroundUploadTestEnabled();

    return ctx.db
      .select()
      .from(BackgroundUploadTestFile)
      .where(eq(BackgroundUploadTestFile.userId, ctx.session.user.id))
      .orderBy(desc(BackgroundUploadTestFile.createdAt));
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      assertBackgroundUploadTestEnabled();

      const file = (
        await ctx.db
          .select()
          .from(BackgroundUploadTestFile)
          .where(
            and(
              eq(BackgroundUploadTestFile.id, input.id),
              eq(BackgroundUploadTestFile.userId, ctx.session.user.id),
            ),
          )
          .limit(1)
      )[0];

      if (!file) {
        return { ok: false as const, reason: "not_found" as const };
      }

      const utapi = new UTApi();
      await utapi.deleteFiles(file.fileKey).catch(() => undefined);

      await ctx.db
        .delete(BackgroundUploadTestFile)
        .where(
          and(
            eq(BackgroundUploadTestFile.id, input.id),
            eq(BackgroundUploadTestFile.userId, ctx.session.user.id),
          ),
        );

      return { ok: true as const };
    }),
} satisfies TRPCRouterRecord;
