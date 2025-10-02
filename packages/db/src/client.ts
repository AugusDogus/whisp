import type { Client } from "@libsql/client";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
  client: Client | undefined;
};

const client =
  globalForDb.client ??
  createClient({
    url: process.env.DATABASE_URL ?? "",
    authToken: process.env.DATABASE_TOKEN ?? "",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.client = client;
}

export const db = drizzle({
  client,
  schema,
});
