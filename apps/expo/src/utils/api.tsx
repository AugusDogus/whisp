import { createTRPCClient, httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";

import type { AppRouter, RouterOutputs } from "@acme/api";

import { authClient } from "./auth";
import { getBaseUrl } from "./base-url";

export const trpc = createTRPCReact<AppRouter>();

// tRPC includes the path on response log events, but omits it from their types.
function isEncryptionOperation(operation: object): boolean {
  return (
    "path" in operation &&
    typeof operation.path === "string" &&
    operation.path.startsWith("mls.")
  );
}

export function createExpoTRPCClient(authCookie?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      loggerLink({
        enabled: (opts) =>
          !isEncryptionOperation(opts) &&
          (process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error)),
        colorMode: "ansi",
      }),
      httpBatchLink({
        transformer: superjson,
        url: `${getBaseUrl()}/api/trpc`,
        headers() {
          const headers = new Map<string, string>();
          headers.set("x-trpc-source", "expo-react");

          const cookies = authCookie ?? authClient.getCookie();
          if (cookies) {
            headers.set("Cookie", cookies);
          }
          return headers;
        },
      }),
    ],
  });
}

export { type RouterInputs, type RouterOutputs } from "@acme/api";
export type FriendsListOutput = RouterOutputs["friends"]["list"];
