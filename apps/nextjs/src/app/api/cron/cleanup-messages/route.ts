import { NextResponse } from "next/server";

import { UTApi } from "uploadthing/server";

import { PreviewScope } from "@acme/api/preview-scope";
import { SafetyCleanup } from "@acme/api/safety-cleanup";
import { db } from "@acme/db/client";

import { env } from "~/env";

/**
 * Cleanup old messages that have been soft-deleted for more than 30 days
 * and their associated delivery records.
 *
 * This endpoint is triggered by Vercel Cron (see vercel.json).
 */
export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { messages, ...safety } = await SafetyCleanup.run(
      db,
      PreviewScope.fromEnvironment(process.env),
      // Instantiate storage lazily so configuration/provider failures cannot skip expiry.
      (key) => new UTApi().deleteFiles(key),
    );
    return NextResponse.json(
      {
        success: safety.failed === 0,
        safety,
        ...messages,
        ...(safety.failed > 0
          ? {
              error:
                "Some account files could not be deleted. Database expiry completed; file jobs remain queued for retry.",
            }
          : {}),
        timestamp: new Date().toISOString(),
      },
      { status: safety.failed > 0 ? 503 : 200 },
    );
  } catch (error) {
    console.error("Error cleaning up messages:", error);
    return NextResponse.json(
      {
        error: "Failed to cleanup messages",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
