import { afterEach, expect, spyOn, test } from "bun:test";

import { ReportAlerts } from "./report-alerts";

const url = "https://discord.com/api/webhooks/123/secret";
const report = { id: "report-1", reason: "harassment" } as const;
let fetchMock = spyOn(globalThis, "fetch");
afterEach(() => {
  fetchMock.mockRestore();
  fetchMock = spyOn(globalThis, "fetch");
});

test("posts only the report category and ID, without pinging anyone", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  expect(await ReportAlerts.notify(url, report)).toEqual({ status: "sent" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [target, init] = fetchMock.mock.calls[0] ?? [];
  expect(target).toBe(url);
  const body: unknown = JSON.parse(String(init?.body));
  expect(body).toEqual({
    content: expect.stringContaining("harassment"),
    allowed_mentions: { parse: [] },
  });
  expect(JSON.stringify(body)).toContain("report-1");
});

test("skips silently when no webhook is configured", async () => {
  expect(await ReportAlerts.notify(undefined, report)).toEqual({
    status: "not_configured",
  });
  expect(await ReportAlerts.notify("", report)).toEqual({
    status: "not_configured",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("refuses URLs that are not Discord webhooks", async () => {
  expect(await ReportAlerts.notify("https://example.com/hook", report)).toEqual(
    { status: "misconfigured" },
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

test("reports Discord and network failures as values instead of throwing", async () => {
  fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));
  expect(await ReportAlerts.notify(url, report)).toEqual({
    status: "failed",
    reason: "Discord responded with HTTP 429",
  });
  fetchMock.mockRejectedValue(new Error("socket hang up"));
  expect(await ReportAlerts.notify(url, report)).toEqual({
    status: "failed",
    reason: "socket hang up",
  });
});
