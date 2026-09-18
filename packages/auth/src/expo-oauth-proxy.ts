import { expo } from "@better-auth/expo";
import { createAuthMiddleware } from "better-auth/api";

/** Apply Expo's cookie handoff to Better Auth's cross-database proxy callback. */
export function expoWithOAuthProxy(baseUrl: string, productionUrl: string) {
  const plugin = expo();
  return {
    ...plugin,
    onRequest: async (...args: Parameters<typeof plugin.onRequest>) => {
      const [request] = args;
      if (baseUrl !== productionUrl) {
        // Expo opts out by default, but a preview's state lives in its own DB.
        const headers = new Headers(request.headers);
        headers.delete("x-skip-oauth-proxy");
        args[0] = new Request(request, { headers });
      }
      return (await plugin.onRequest(...args)) ?? { request: args[0] };
    },
    hooks: {
      after: [
        ...plugin.hooks.after.map((hook) => ({
          ...hook,
          matcher: (context: Parameters<typeof hook.matcher>[0]) =>
            hook.matcher(context) || context.path === "/oauth-proxy-callback",
        })),
        {
          matcher: (context: { path?: string; headers?: Headers }) =>
            context.path === "/sign-in/social" &&
            Boolean(context.headers?.has("expo-origin")) &&
            !context.headers?.has("x-whisp-auth-client"),
          handler: createAuthMiddleware(async (context) => {
            // Existing 1.3 APKs open the provider directly. Route them through
            // Expo's built-in browser handoff so the state cookie is preserved.
            const response = context.context.returned;
            if (
              !response ||
              typeof response !== "object" ||
              !("url" in response) ||
              typeof response.url !== "string"
            )
              return;
            const browser = new URL(
              "/api/auth/expo-authorization-proxy",
              baseUrl,
            );
            browser.searchParams.set("authorizationURL", response.url);
            return context.json({ ...response, url: browser.toString() });
          }),
        },
      ],
    },
  };
}
