/// <reference types="bun-types/test" />
import { TRPCError } from "@trpc/server";
import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";

import { DiscordNameplate } from "../../../../../lib/discord-nameplate";

const staticUrl =
  "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/static.png";
let denied: "UNAUTHORIZED" | "FORBIDDEN" | null = null;
let nameplate: string | null = staticUrl;
let requestedUser: string | undefined;
const conversion = spyOn(DiscordNameplate, "load").mockResolvedValue(
  Buffer.from("converted-webp").toString("base64"),
);
mock.module("next/cache", () => ({
  unstable_cache: (fn: typeof DiscordNameplate.load) => fn,
}));
mock.module("~/auth/server", () => ({ auth: {} }));
mock.module("@acme/api", () => ({
  createTRPCContext: async () => ({}),
  appRouter: {
    createCaller: () => ({
      auth: {
        discordProfile: async ({ userId }: { userId: string }) => {
          requestedUser = userId;
          if (denied) throw new TRPCError({ code: denied });
          return { profile: { cosmetics: { nameplateUrl: nameplate } } };
        },
      },
    }),
  },
}));
const { GET } = await import("./route");
const request = () =>
  new Request(
    `http://localhost/api/discord-profile/friend/nameplate?asset=${encodeURIComponent(staticUrl)}`,
  );
const context = { params: Promise.resolve({ userId: "friend" }) };
beforeEach(() => {
  denied = null;
  nameplate = staticUrl;
  requestedUser = undefined;
  conversion.mockClear();
  conversion.mockResolvedValue(
    Buffer.from("converted-webp").toString("base64"),
  );
});
afterAll(() => {
  conversion.mockRestore();
  mock.restore();
});

test("authorizes the profile before converting and returns privately cached WebP", async () => {
  const response = await GET(request(), context);
  expect(requestedUser).toBe("friend");
  expect(conversion).toHaveBeenCalledWith(staticUrl);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/webp");
  expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
  expect(await response.text()).toBe("converted-webp");
});

test.each(["UNAUTHORIZED", "FORBIDDEN"] as const)(
  "does not convert inaccessible profiles",
  async (code) => {
    denied = code;
    const response = await GET(request(), context);
    expect(response.status).toBe(code === "UNAUTHORIZED" ? 401 : 403);
    expect(conversion).not.toHaveBeenCalled();
  },
);

test("does not convert a removed or changed nameplate from an old URL", async () => {
  nameplate = null;
  expect((await GET(request(), context)).status).toBe(404);
  nameplate = staticUrl.replace("twilight", "other");
  expect((await GET(request(), context)).status).toBe(404);
  expect(conversion).not.toHaveBeenCalled();
});

test("conversion failures are uncached errors so a later request can retry", async () => {
  conversion.mockRejectedValueOnce(new Error("Discord unavailable"));
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await GET(request(), context);
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(log).toHaveBeenCalled();
    expect((await GET(request(), context)).status).toBe(200);
  } finally {
    log.mockRestore();
  }
});
