import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { fileURLToPath } from "node:url";
import { z } from "zod/v4";

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    DATABASE_TOKEN: z.string().min(1),
  })
  .parse(process.env);
const client = createClient({
  url: env.DATABASE_URL,
  authToken: env.DATABASE_TOKEN,
});
try {
  await migrate(drizzle(client), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  console.log("Database migrations applied.");
} finally {
  client.close();
}
