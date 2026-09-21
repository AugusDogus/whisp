import { z } from "zod/v4";

export const CONTENT_POLICY_VERSION = "2026-09-21";

export const reportReasons = [
  "spam",
  "harassment",
  "sexual_content",
  "child_safety",
  "violence",
  "other",
] as const;

export const reportInput = z.object({
  userId: z.string().min(1).max(128),
  reason: z.enum(reportReasons),
  details: z.string().trim().max(2000).default(""),
});
