import type { UpdatesLogEntry } from "expo-updates";

import { expect, mock, test } from "bun:test";

import { createStartupErrorReporter } from "./expo-startup-errors";

const fatal = {
  timestamp: 1000,
  message: "Fatal error: User interaction is not allowed",
  code: "JSRuntimeError",
  level: "error",
  updateId: "failed-update",
};

// Expo's enum types describe the native bridge's string values.
function entry(overrides: Partial<typeof fatal> = {}) {
  return { ...fatal, ...overrides };
}

function harness() {
  let checkpoint = 0;
  const logs = [entry()];
  const capture = mock(
    (_log: Pick<UpdatesLogEntry, "timestamp" | "message">) => {},
  );
  const flush = mock(async () => true);
  const writeCheckpoint = mock(async (value: number) => {
    checkpoint = value;
  });
  const report = createStartupErrorReporter({
    readLogs: async () => logs,
    readCheckpoint: async () => checkpoint,
    writeCheckpoint,
    capture,
    flush,
  });
  return { logs, capture, flush, writeCheckpoint, report };
}

test("reports original startup errors, excluding unrelated update logs", async () => {
  const h = harness();
  h.logs.push(entry({ code: "UpdateServerUnreachable", message: "Offline" }));
  h.logs.push(entry({ level: "info" }));
  await h.report();
  expect(h.capture.mock.calls).toEqual([[fatal]]);
  expect(h.writeCheckpoint).toHaveBeenCalledWith(1000);
  await h.report();
  expect(h.capture).toHaveBeenCalledTimes(1);
});

test("keeps all errors sharing a timestamp and includes initialization failures", async () => {
  const h = harness();
  h.logs.push(
    entry({ message: "Second fatal error", code: "InitializationError" }),
  );
  await h.report();
  expect(h.capture).toHaveBeenCalledTimes(2);
});

test("does not checkpoint errors until Sentry accepts the batch", async () => {
  const h = harness();
  h.flush.mockResolvedValueOnce(false);
  await h.report();
  expect(h.writeCheckpoint).not.toHaveBeenCalled();
  await h.report();
  expect(h.writeCheckpoint).toHaveBeenCalledWith(1000);
});

test("drains each error before enqueueing another, even beyond Sentry's queue limit", async () => {
  const h = harness();
  for (let i = 1; i < 40; i++) h.logs.push(entry({ timestamp: 1000 + i }));
  let queued = 0;
  h.capture.mockImplementation(() => {
    queued++;
    expect(queued).toBe(1);
  });
  h.flush.mockImplementation(async () => {
    queued--;
    return true;
  });
  await h.report();
  expect(h.capture).toHaveBeenCalledTimes(40);
  expect(h.writeCheckpoint).toHaveBeenCalledWith(1039);
});

test("retries the entire batch if handoff fails midway through equal timestamps", async () => {
  const h = harness();
  h.logs.push(entry({ message: "Second fatal error" }));
  h.flush.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await h.report();
  expect(h.writeCheckpoint).not.toHaveBeenCalled();
  await h.report();
  expect(h.capture).toHaveBeenCalledTimes(4);
  expect(h.writeCheckpoint).toHaveBeenCalledWith(1000);
});

test("serializes overlapping foreground attempts", async () => {
  const h = harness();
  await Promise.all([h.report(), h.report()]);
  expect(h.capture).toHaveBeenCalledTimes(1);
});

test("retries after a rejected flush without recording success", async () => {
  const h = harness();
  h.flush.mockRejectedValueOnce(new Error("transport failed"));
  await expect(h.report()).rejects.toThrow("transport failed");
  expect(h.writeCheckpoint).not.toHaveBeenCalled();
  await h.report();
  expect(h.writeCheckpoint).toHaveBeenCalledWith(1000);
});
