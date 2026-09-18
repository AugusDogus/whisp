import { z } from "zod/v4";

const previewPrNumber = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine((value) => value === value.trim());

export type PreviewScope = { prNumber: string; prefix: string };

export const PreviewScope = {
  parse(prNumber: string): PreviewScope {
    return {
      prNumber: previewPrNumber.parse(prNumber),
      prefix: `whisp-pr-${prNumber}:`,
    };
  },
  fromEnvironment(env: NodeJS.ProcessEnv): PreviewScope | undefined {
    if (env.PREVIEW_PR_NUMBER) {
      if (env.VERCEL_ENV === "production") {
        throw new Error("Production cannot use PREVIEW_PR_NUMBER.");
      }
      return PreviewScope.parse(env.PREVIEW_PR_NUMBER);
    }
    if (env.VERCEL_ENV === "preview") {
      throw new Error(
        "Preview uploads require PREVIEW_PR_NUMBER. Redeploy using the Preview workflow.",
      );
    }
    return undefined;
  },
  fromCustomId(customId: string | null): PreviewScope | undefined {
    const match = customId?.match(
      /^whisp-pr-([1-9][0-9]*):[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    if (match?.[0] !== customId) return undefined;
    return match?.[1] ? PreviewScope.parse(match[1]) : undefined;
  },
  owns(scope: PreviewScope, customId: string | null): boolean {
    return PreviewScope.fromCustomId(customId)?.prNumber === scope.prNumber;
  },
} as const;
