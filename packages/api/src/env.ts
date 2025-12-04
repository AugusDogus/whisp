import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod/v4";

export function apiEnv() {
  return createEnv({
    server: {
      UPSTASH_REDIS_REST_URL: z.url(),
      UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
    },
    experimental__runtimeEnv: {},
    skipValidation:
      !!process.env.CI || process.env.npm_lifecycle_event === "lint",
  });
}
