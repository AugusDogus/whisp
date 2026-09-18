import { unstable_cache } from "next/cache";

import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";

import { appRouter, createTRPCContext } from "@acme/api";

import { auth } from "~/auth/server";
import { DiscordNameplate } from "~/lib/discord-nameplate";

export const runtime = "nodejs";
export const maxDuration = 60;

// Share the converted public asset across viewers, but authorize each HTTP request.
const loadAnimation = unstable_cache(
  DiscordNameplate.load,
  ["discord-nameplate-webp-v1"],
  { revalidate: 86400 },
);

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  try {
    const caller = appRouter.createCaller(
      await createTRPCContext({ auth, headers: request.headers }),
    );
    const { profile } = await caller.auth.discordProfile({ userId });
    const staticUrl = profile.cosmetics?.nameplateUrl;
    if (
      !staticUrl ||
      new URL(request.url).searchParams.get("asset") !== staticUrl
    ) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const data = Buffer.from(await loadAnimation(staticUrl), "base64");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=86400",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof TRPCError) {
      return new Response(null, {
        status: getHTTPStatusCodeFromError(error),
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error(
      "Discord nameplate conversion failed; the client keeps the static asset",
      { userId, error },
    );
    return new Response(null, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
