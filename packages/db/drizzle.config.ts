import type { Config } from "drizzle-kit";

if (!process.env.DATABASE_URL || !process.env.DATABASE_TOKEN) {
  throw new Error("Missing Database configuration");
}

export default {
  schema: "./src/schema.ts",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    authToken: process.env.DATABASE_TOKEN,
  },
} satisfies Config;
