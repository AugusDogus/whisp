import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, expect, spyOn, test } from "bun:test";

import { initAuth } from "./index";

const productionURL = "https://whisp.chat";
const previewURL = "https://whisp-test-augies-projects.vercel.app";
const proxySecret = "test-proxy-secret-at-least-32-characters";
const mocks: ReturnType<typeof spyOn>[] = [];
afterEach(() => mocks.splice(0).forEach((mock) => mock.mockRestore()));

async function fixture(baseUrl: string) {
  const store: Record<
    "user" | "session" | "account" | "verification",
    Record<string, unknown>[]
  > = { user: [], session: [], account: [], verification: [] };
  const auth = initAuth({
    database: memoryAdapter(store),
    baseUrl,
    productionUrl: productionURL,
    secret: `${baseUrl}-session-secret-at-least-32-characters`,
    proxySecret,
    discordClientId: "test-discord-client",
    discordClientSecret: "test-discord-secret",
  });
  const context = await auth.$context;
  // Better Auth disables origin checks under bun:test unless explicitly restored.
  context.skipOriginCheck = false;
  return { auth, store };
}

function location(response: Response) {
  expect(response.status).toBe(302);
  const value = response.headers.get("location");
  if (!value) throw new Error("Auth response did not include a redirect.");
  return new URL(value);
}

const hash = "8342729096ea3675442027381ff50dfe";
const discordProfile = {
  id: "123456789",
  username: "preview-tester",
  discriminator: "0",
  global_name: "Preview Tester",
  email: "preview@example.com",
  verified: true,
  avatar: null,
  banner: hash,
  accent_color: 0,
  public_flags: 1 << 6,
};

function expectCosmetics(user: Record<string, unknown> | undefined) {
  expect(user).toMatchObject({
    discordUsername: "preview-tester",
    discordBannerUrl: `https://cdn.discordapp.com/banners/123456789/${hash}.webp?size=1024`,
    discordAccentColor: 0,
    discordPublicFlags: 1 << 6,
  });
  expect(user?.discordProfileSyncedAt).toBeInstanceOf(Date);
  expect(user?.discordProfileRevision).toEqual(expect.any(String));
}

function mockDiscord(proxyResponse = () => Response.json(discordProfile)) {
  let profileRequests = 0;
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.hostname !== "discord.com") {
          throw new Error(
            `Unexpected OAuth test request: ${url.origin}${url.pathname}`,
          );
        }
        if (url.pathname === "/api/oauth2/token") {
          return Response.json({
            access_token: "test-access-token",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "identify email",
          });
        }
        if (decodeURIComponent(url.pathname) === "/api/users/@me") {
          profileRequests += 1;
          return profileRequests === 1
            ? Response.json(discordProfile)
            : proxyResponse();
        }
        throw new Error(`Unexpected Discord test path: ${url.pathname}`);
      },
      { preconnect: fetch.preconnect },
    ),
  );
  mocks.push(mock);
}

const previewCases = ["legacy", "current"].flatMap((client) => [
  { client, outcome: "success", response: () => Response.json(discordProfile) },
  {
    client,
    outcome: "malformed profile",
    response: () => Response.json({ ...discordProfile, banner: "invalid" }),
  },
  {
    client,
    outcome: "different identity",
    response: () => Response.json({ ...discordProfile, id: "987654321" }),
  },
  {
    client,
    outcome: "Discord unavailable",
    response: () => new Response(null, { status: 503 }),
  },
]);

test.each(previewCases)(
  "$client native preview login: $outcome",
  async ({ client, outcome, response }) => {
    const production = await fixture(productionURL);
    const preview = await fixture(previewURL);
    mockDiscord(response);

    const signIn = await preview.auth.handler(
      new Request(`${previewURL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "expo-origin": "whisp-preview://",
          "x-skip-oauth-proxy": "true",
          ...(client === "current" ? { "x-whisp-auth-client": "1.6" } : {}),
        },
        body: JSON.stringify({
          provider: "discord",
          callbackURL: "whisp-preview://camera",
        }),
      }),
    );
    expect(signIn.status).toBe(200);
    const body: unknown = await signIn.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("url" in body) ||
      typeof body.url !== "string"
    ) {
      throw new Error("Sign-in response did not include a provider URL.");
    }
    const providerURL =
      client === "legacy"
        ? location(await preview.auth.handler(new Request(body.url)))
        : new URL(body.url);
    expect(providerURL.searchParams.get("redirect_uri")).toBe(
      `${productionURL}/api/auth/callback/discord`,
    );
    const state = providerURL.searchParams.get("state");
    if (!state)
      throw new Error("Sign-in response did not include OAuth state.");
    const callback = new URL(`${productionURL}/api/auth/callback/discord`);
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", "test-code");

    const relay = location(
      await production.auth.handler(new Request(callback.toString())),
    );
    expect(relay.origin).toBe(previewURL);
    expect(production.store.user).toHaveLength(0);
    expect(production.store.session).toHaveLength(0);
    expect(production.store.account).toHaveLength(0);

    const complete = await preview.auth.handler(new Request(relay.toString()));
    if (outcome !== "success") {
      expect(complete.status).toBe(502);
      expect(preview.store.session).toHaveLength(0);
      expect(preview.store.user[0]?.discordProfileRevision).toBeUndefined();
      expect(production.store.user).toHaveLength(0);
      return;
    }
    const mobile = location(complete);
    expect(`${mobile.protocol}//${mobile.host}`).toBe("whisp-preview://camera");
    expect(mobile.searchParams.get("cookie")).toContain(
      "better-auth.session_token",
    );
    expect(preview.store.session).toHaveLength(1);
    expect(preview.store.user).toHaveLength(1);
    expect(preview.store.account).toHaveLength(1);
    expectCosmetics(preview.store.user[0]);

    const replay = location(
      await preview.auth.handler(new Request(relay.toString())),
    );
    expect(replay.searchParams.get("error")).toBe("state_mismatch");
    expect(preview.store.session).toHaveLength(1);
  },
);

test.each(["legacy", "current"])(
  "%s production mobile login succeeds",
  async (client) => {
    const production = await fixture(productionURL);
    mockDiscord();
    const signIn = await production.auth.handler(
      new Request(`${productionURL}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "expo-origin": "whisp://",
          "x-skip-oauth-proxy": "true",
          ...(client === "current" ? { "x-whisp-auth-client": "1.6" } : {}),
        },
        body: JSON.stringify({
          provider: "discord",
          callbackURL: "whisp://camera",
        }),
      }),
    );
    expect(signIn.status).toBe(200);
    const body: unknown = await signIn.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("url" in body) ||
      typeof body.url !== "string"
    ) {
      throw new Error("Sign-in response did not include a provider URL.");
    }
    const proxy =
      client === "legacy"
        ? new URL(body.url)
        : new URL(`${productionURL}/api/auth/expo-authorization-proxy`);
    if (client === "current")
      proxy.searchParams.set("authorizationURL", body.url);
    const browser = await production.auth.handler(
      new Request(proxy.toString()),
    );
    const provider = location(browser);
    expect(provider.origin).toBe("https://discord.com");
    const cookie = browser.headers.get("set-cookie");
    if (!cookie) throw new Error("Expo did not set the browser state cookie.");
    const state = provider.searchParams.get("state");
    if (!state)
      throw new Error("Sign-in response did not include OAuth state.");
    const callback = new URL(`${productionURL}/api/auth/callback/discord`);
    callback.searchParams.set("state", state);
    callback.searchParams.set("code", "test-code");
    const complete = location(
      await production.auth.handler(
        new Request(callback.toString(), {
          headers: { cookie: cookie.split(";")[0] ?? "" },
        }),
      ),
    );
    expect(complete.protocol).toBe("whisp:");
    expect(complete.searchParams.get("cookie")).toContain(
      "better-auth.session_token",
    );
    expect(production.store.session).toHaveLength(1);
    expectCosmetics(production.store.user[0]);
  },
);

test("an unrelated Vercel project cannot start an OAuth login", async () => {
  const production = await fixture(productionURL);
  const response = await production.auth.handler(
    new Request(`${productionURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: productionURL },
      body: JSON.stringify({
        provider: "discord",
        callbackURL: "https://unrelated-augies-projects.vercel.app",
      }),
    }),
  );
  expect(response.status).toBe(403);
  expect(production.store.verification).toHaveLength(0);
});
