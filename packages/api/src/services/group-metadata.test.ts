import { expect, test } from "bun:test";

import { eq } from "@acme/db";
import {
  Group,
  GroupMember,
  ContentPolicyAcceptance,
  UserBlock,
} from "@acme/db/schema";

import { Blocking } from "./blocking";
import { GroupMetadata } from "./group-metadata";
import { createSafetyTestDatabase } from "./safety-test-fixture";

const database = await createSafetyTestDatabase();
async function sharedGroup() {
  await database
    .insert(Group)
    .values({ id: "shared", name: "Friends", createdById: "alice" });
  await database.insert(GroupMember).values(
    ["alice", "bob", "carol"].map((userId) => ({
      groupId: "shared",
      userId,
    })),
  );
}

test("either direction of blocking prevents group-name contact without restricting other members", async () => {
  await sharedGroup();
  await database.transaction((tx) => Blocking.block(tx, "alice", "bob"));
  for (const userId of ["alice", "bob"]) {
    expect(
      await GroupMetadata.rename(database, userId, {
        groupId: "shared",
        name: "Unwanted contact",
      }),
    ).toEqual({ status: "unavailable" });
  }
  expect((await database.select().from(Group))[0]?.name).toBe("Friends");
  expect(
    await GroupMetadata.rename(database, "carol", {
      groupId: "shared",
      name: "Holiday",
    }),
  ).toEqual({ status: "renamed" });
  expect((await database.select().from(Group))[0]?.name).toBe("Holiday");
  await database.delete(UserBlock);
  expect(
    await GroupMetadata.rename(database, "bob", {
      groupId: "shared",
      name: "Friends again",
    }),
  ).toEqual({ status: "renamed" });
});

test("renaming rechecks current sharing permission and membership inside the transaction", async () => {
  await sharedGroup();
  await database
    .delete(ContentPolicyAcceptance)
    .where(eq(ContentPolicyAcceptance.userId, "bob"));
  expect(
    await GroupMetadata.rename(database, "bob", {
      groupId: "shared",
      name: "Not accepted",
    }),
  ).toEqual({ status: "restricted" });
  await database.delete(GroupMember).where(eq(GroupMember.userId, "carol"));
  expect(
    await GroupMetadata.rename(database, "carol", {
      groupId: "shared",
      name: "No membership",
    }),
  ).toEqual({ status: "unavailable" });
  expect((await database.select().from(Group))[0]?.name).toBe("Friends");
});
