/// <reference lib="es2024.promise" />
import { describe, expect, mock, spyOn, test } from "bun:test";

import { observeNativeSends } from "./native-send-observer";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness(events = true) {
  let statusListener: (() => void) | undefined;
  let activateListener: (() => void) | undefined;
  const state = { active: true, current: true };
  const statusRemoved = mock(() => {});
  const activationRemoved = mock(() => {});
  const configure = mock(async () => {});
  const resume = mock(async () => {});
  const reconcile = mock(async () => {});
  const onError = mock(() => {});
  return {
    state,
    configure,
    resume,
    reconcile,
    onError,
    statusRemoved,
    activationRemoved,
    changed: () => statusListener?.(),
    activate: () => activateListener?.(),
    start: () =>
      observeNativeSends({
        isActive: () => state.active,
        isCurrent: () => state.current,
        configure,
        resume,
        reconcile,
        onError,
        subscribeStatus(listener) {
          statusListener = listener;
          return events ? { remove: statusRemoved } : undefined;
        },
        subscribeActivation(listener) {
          activateListener = listener;
          return { remove: activationRemoved };
        },
      }),
  };
}

describe("native send observation", () => {
  test("subscribes before startup, waits for account configuration, then reads immediately", async () => {
    const h = harness();
    const configured = Promise.withResolvers<void>();
    h.configure.mockImplementation(() => configured.promise);
    const stop = h.start();
    try {
      h.changed();
      expect(h.reconcile).not.toHaveBeenCalled();
      configured.resolve();
      await tick();
      expect(h.configure).toHaveBeenCalledTimes(1);
      expect(h.resume).toHaveBeenCalledTimes(1);
      expect(h.reconcile).toHaveBeenCalled();
      const before = h.reconcile.mock.calls.length;
      h.changed();
      await tick();
      expect(h.reconcile).toHaveBeenCalledTimes(before + 1);
    } finally {
      stop();
    }
  });

  test("coalesces transitions during a read without losing the final completion", async () => {
    const h = harness();
    const firstRead = Promise.withResolvers<void>();
    h.reconcile.mockImplementationOnce(() => firstRead.promise);
    const stop = h.start();
    try {
      await tick();
      expect(h.reconcile).toHaveBeenCalledTimes(1);
      h.changed();
      h.changed();
      expect(h.reconcile).toHaveBeenCalledTimes(1);
      firstRead.resolve();
      await tick();
      expect(h.reconcile).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  test("reads background completions on activation after reconfiguring and resuming", async () => {
    const h = harness();
    const stop = h.start();
    try {
      await tick();
      h.state.active = false;
      h.changed();
      await tick();
      expect(h.reconcile).toHaveBeenCalledTimes(1);
      h.state.active = true;
      h.activate();
      await tick();
      expect(h.configure).toHaveBeenCalledTimes(2);
      expect(h.resume).toHaveBeenCalledTimes(2);
      expect(h.reconcile).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  test("does not read jobs after the account changes during configuration", async () => {
    const h = harness();
    const configured = Promise.withResolvers<void>();
    h.configure.mockImplementation(() => configured.promise);
    const stop = h.start();
    try {
      h.state.current = false;
      configured.resolve();
      h.changed();
      await tick();
      expect(h.resume).not.toHaveBeenCalled();
      expect(h.reconcile).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  test("removes subscriptions and suppresses pending work after unmount", async () => {
    const h = harness();
    const configured = Promise.withResolvers<void>();
    h.configure.mockImplementation(() => configured.promise);
    const stop = h.start();
    stop();
    configured.resolve();
    h.changed();
    h.activate();
    await tick();
    expect(h.statusRemoved).toHaveBeenCalledTimes(1);
    expect(h.activationRemoved).toHaveBeenCalledTimes(1);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  test("retries after a failed read when a newer native transition is pending", async () => {
    const h = harness();
    const firstRead = Promise.withResolvers<void>();
    h.reconcile.mockImplementationOnce(() => firstRead.promise);
    const stop = h.start();
    try {
      await tick();
      h.changed();
      firstRead.reject(new Error("temporary read failure"));
      await tick();
      expect(h.onError).toHaveBeenCalledTimes(1);
      expect(h.configure).toHaveBeenCalledTimes(2);
      expect(h.reconcile).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  test.each([
    [true, 30_000],
    [false, 2_000],
  ])(
    "uses the appropriate recovery interval for event support %s",
    (events, interval) => {
      const timer = spyOn(globalThis, "setInterval");
      const h = harness(events);
      const stop = h.start();
      try {
        expect(timer).toHaveBeenCalledWith(expect.any(Function), interval);
      } finally {
        stop();
        timer.mockRestore();
      }
    },
  );
});
