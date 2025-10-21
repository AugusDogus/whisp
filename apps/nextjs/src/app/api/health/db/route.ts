import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@acme/db/client";

/**
 * Database health check endpoint
 * Tests database connectivity and basic query execution
 * Returns 200 if database is accessible and responding
 */
export async function GET() {
  try {
    const startTime = Date.now();

    // Test database connection with a simple query
    // Using db.get() which is available in the Drizzle libsql adapter
    await db.get<{ result: number }>(sql`SELECT 1 as result`);

    const responseTime = Date.now() - startTime;

    return NextResponse.json(
      {
        status: "ok",
        timestamp: new Date().toISOString(),
        database: "connected",
        responseTime: `${responseTime}ms`,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Database health check failed:", error);
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        database: "disconnected",
      },
      { status: 503 },
    );
  }
}
