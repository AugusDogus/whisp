import { createClient } from "@libsql/client";
import { initTRPC } from "@trpc/server";
import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import { eq } from "@acme/db";
import * as schema from "@acme/db/schema";

import { sendNotificationToUser } from "../utils/send-notification";

const client = createClient({ url: "file::memory:" });
const db = drizzle({ client, schema });
const t = initTRPC
  .context<{
    db: typeof db;
    session: { user: { id: string }; session: { id: string } };
  }>()
  .create();
mock.module("../trpc", () => ({ protectedProcedure: t.procedure }));
const { notificationsRouter } = await import("./notifications");
const router = t.router(notificationsRouter);
const account = (id: string, sessionId = id) =>
  router.createCaller({
    db,
    session: { user: { id }, session: { id: sessionId } },
  });

for (const migration of ["0000_baseline", "0001_discord_cosmetics"]) {
  await client.executeMultiple(
    await Bun.file(
      new URL(`../../../db/drizzle/${migration}.sql`, import.meta.url),
    ).text(),
  );
}
// Legacy tokens are kept but cannot be trusted until an authenticated registration.
await client.execute(
  "INSERT INTO push_token (id, userId, token, platform, createdAt) VALUES ('legacy', 'legacy', 'legacy-token', 'ios', 0)",
);
await client.executeMultiple(
  await Bun.file(
    new URL(
      "../../../db/drizzle/0002_push_token_sessions.sql",
      import.meta.url,
    ),
  ).text(),
);
const legacy = await db.query.PushToken.findFirst();

beforeEach(async () => {
  await db.delete(schema.PushToken);
  await db.delete(schema.session);
  await db.delete(schema.user);
  for (const id of ["old", "new", "me"]) {
    await db.insert(schema.user).values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    for (const sessionId of [id, `${id}-other`]) {
      await db.insert(schema.session).values({
        id: sessionId,
        userId: id,
        token: sessionId,
        expiresAt: new Date(Date.now() + 86400000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
});
afterAll(() => {
  mock.restore();
  client.close();
});

const device = { token: "ExponentPushToken[device]", platform: "ios" as const };

test("switching accounts transfers the device token and preserves other devices", async () => {
  const first = await account("old").registerPushToken(device);
  await account("old", "old-other").registerPushToken({
    ...device,
    token: "other-device",
  });
  const second = await account("new").registerPushToken(device);
  expect(second.tokenId).toBe(first.tokenId);
  expect(
    await db.query.PushToken.findMany({
      columns: { token: true, userId: true },
    }),
  ).toEqual(
    expect.arrayContaining([
      { token: device.token, userId: "new" },
      { token: "other-device", userId: "old" },
    ]),
  );
});

test("repeated and concurrent registration leaves one token with current metadata", async () => {
  await Promise.all([
    account("me").registerPushToken(device),
    account("me").registerPushToken(device),
  ]);
  await account("me").registerPushToken({ ...device, platform: "android" });
  expect(await db.query.PushToken.findMany()).toMatchObject([
    { userId: "me", token: device.token, platform: "android" },
  ]);
});

test("old-account cleanup cannot remove a token owned by the new account", async () => {
  await account("new").registerPushToken(device);
  await account("old").removePushToken({ token: device.token });
  expect(await db.query.PushToken.findMany()).toHaveLength(1);
  await account("new").removePushToken({ token: device.token });
  expect(await db.query.PushToken.findMany()).toHaveLength(0);
});

test("legacy tokens remain unbound after migration", () => {
  expect(legacy).toMatchObject({ token: "legacy-token", sessionId: null });
});

test("revoking a session removes only that session's registration", async () => {
  await account("me").registerPushToken(device);
  await account("me", "me-other").registerPushToken({
    ...device,
    token: "other-device",
  });
  await db.delete(schema.session).where(eq(schema.session.id, "me"));
  expect(await db.query.PushToken.findMany()).toMatchObject([
    { token: "other-device", sessionId: "me-other" },
  ]);
});

test("a request authenticated before revocation cannot recreate its registration", async () => {
  const staleCaller = account("me");
  await db.delete(schema.session).where(eq(schema.session.id, "me"));
  await account("new").registerPushToken(device);
  await expect(staleCaller.registerPushToken(device)).rejects.toThrow();
  expect(await db.query.PushToken.findMany()).toMatchObject([
    { token: device.token, userId: "new", sessionId: "new" },
  ]);
});

test("old-session logout and cleanup preserve a transferred registration", async () => {
  await account("me").registerPushToken(device);
  await account("me", "me-other").registerPushToken(device);
  await account("me").removePushToken({ token: device.token });
  await db.delete(schema.session).where(eq(schema.session.id, "me"));
  expect(await db.query.PushToken.findMany()).toMatchObject([
    { token: device.token, sessionId: "me-other" },
  ]);
});

test("token rotation replaces the old token for the session", async () => {
  await account("me").registerPushToken(device);
  await account("me").registerPushToken({ ...device, token: "rotated" });
  expect(await db.query.PushToken.findMany()).toMatchObject([
    { token: "rotated", sessionId: "me" },
  ]);
});

test("delivery excludes legacy and expired registrations", async () => {
  await account("me").registerPushToken(device);
  await account("me", "me-other").registerPushToken({
    ...device,
    token: "expired",
  });
  await db
    .update(schema.session)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.session.id, "me-other"));
  await db
    .insert(schema.PushToken)
    .values({ userId: "me", token: "unbound", platform: "ios" });
  const requests: string[] = [];
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(String(init?.body));
        return Response.json({ data: [{ status: "ok" }] });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  try {
    await sendNotificationToUser(db, "me", "Test", "Test");
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0] ?? "null")).toMatchObject({
      to: device.token,
    });
    await db.delete(schema.session).where(eq(schema.session.id, "me"));
    expect(await sendNotificationToUser(db, "me", "Test", "Test")).toEqual({
      success: false,
      reason: "no_tokens",
    });
    expect(requests).toHaveLength(1);
  } finally {
    fetchMock.mockRestore();
  }
});

test("failed token rotation preserves the previous registration", async () => {
  await account("me").registerPushToken(device);
  await client.execute(`CREATE TRIGGER fail_registration BEFORE INSERT ON push_token
    WHEN NEW.token = 'rejected' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
  try {
    await expect(
      account("me").registerPushToken({ ...device, token: "rejected" }),
    ).rejects.toThrow();
    expect(await db.query.PushToken.findMany()).toMatchObject([
      { token: device.token, sessionId: "me" },
    ]);
  } finally {
    await client.execute("DROP TRIGGER fail_registration");
  }
});

test("deleting the account cascades through sessions to device registrations", async () => {
  await account("me").registerPushToken(device);
  await account("me", "me-other").registerPushToken({
    ...device,
    token: "other-device",
  });
  await db.delete(schema.user).where(eq(schema.user.id, "me"));
  expect(await db.query.PushToken.findMany()).toHaveLength(0);
});
