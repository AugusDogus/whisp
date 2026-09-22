import { initTRPC, TRPCError } from "@trpc/server";
import { afterAll, expect, mock, test } from "bun:test";

import { Group, GroupMember } from "@acme/db/schema";

import { Blocking } from "../services/blocking";
import { ContentAccess } from "../services/content-access";
import { createSafetyTestDatabase } from "../services/safety-test-fixture";

const database = await createSafetyTestDatabase();
const t = initTRPC
  .context<{ db: typeof database; session: { user: { id: string } } }>()
  .create();
mock.module("../trpc", () => ({
  protectedProcedure: t.procedure,
  sharingProcedure: t.procedure.use(async ({ ctx, next }) => {
    if (
      (await ContentAccess.status(ctx.db, ctx.session.user.id)).status !==
      "allowed"
    )
      throw new TRPCError({ code: "FORBIDDEN" });
    return next();
  }),
}));
const { groupsRouter } = await import("./groups");
const router = t.router(groupsRouter);
const caller = (userId: string) =>
  router.createCaller({ db: database, session: { user: { id: userId } } });
afterAll(() => mock.restore());

test("blocked group renames cannot change the name returned to the blocker", async () => {
  await database
    .insert(Group)
    .values({ id: "shared", name: "Friends", createdById: "alice" });
  await database.insert(GroupMember).values(
    ["alice", "bob", "carol"].map((userId) => ({
      userId,
      groupId: "shared",
    })),
  );
  await database.transaction((tx) => Blocking.block(tx, "alice", "bob"));
  await expect(
    caller("bob").rename({ groupId: "shared", name: "Unwanted contact" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await caller("alice").list()).map((group) => group.name)).toEqual([
    "Friends",
  ]);
  await caller("carol").rename({ groupId: "shared", name: "Holiday" });
  expect((await caller("alice").list()).map((group) => group.name)).toEqual([
    "Holiday",
  ]);
});
