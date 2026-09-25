import { z } from "zod/v4";

const webhookUrl = z
  .url()
  .regex(/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\//);

export type ReportAlert =
  | { status: "sent" }
  | { status: "not_configured" }
  | { status: "misconfigured" }
  | { status: "failed"; reason: string };

// Tells the operator a report is waiting. Report text and account IDs stay out of
// Discord, which is outside whisp's retention and deletion controls.
export const ReportAlerts = {
  async notify(
    configuredUrl: string | undefined,
    report: { id: string; reason: string },
  ): Promise<ReportAlert> {
    if (!configuredUrl) return { status: "not_configured" };
    const url = webhookUrl.safeParse(configuredUrl);
    if (!url.success) return { status: "misconfigured" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url.data, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `New whisp report (${report.reason}). Report ID: ${report.id}`,
          allowed_mentions: { parse: [] },
        }),
        signal: controller.signal,
      });
      if (!response.ok)
        return {
          status: "failed",
          reason: `Discord responded with HTTP ${response.status}`,
        };
      return { status: "sent" };
    } catch (error) {
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  },
} as const;
