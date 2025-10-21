import { NextResponse } from "next/server";

/**
 * Basic health check endpoint
 * Returns 200 if the service is up
 * Use this for simple uptime monitoring
 */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "whisp-api",
    },
    { status: 200 },
  );
}
