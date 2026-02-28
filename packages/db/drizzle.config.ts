import type { Config } from "drizzle-kit";

// generate does not connect to DB; push/studio require credentials
if (
  process.argv.includes("push") ||
  process.argv.includes("studio")
) {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_TOKEN) {
    throw new Error("Missing Database configuration");
  }
}

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:local.db",
    authToken: process.env.DATABASE_TOKEN ?? "",
  },
} satisfies Config;
