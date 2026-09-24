/// <reference lib="es2024.promise" />
/// <reference types="bun-types/test" />
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import type { DevicePushToken } from "expo-notifications";

import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";

import { native } from "../test/setup";

const permission = mock(async () => ({ status: "granted" }));
const acquire = mock(
  async (_options?: { devicePushToken?: DevicePushToken }) => ({
    data: "device-token",
  }),
);
const network = new Set<(state: { isInternetReachable: boolean }) => void>();
const rotation = new Set<(token: DevicePushToken) => void>();
mock.module("react-native-permissions", () => ({
  checkNotifications: permission,
}));
mock.module("expo-device", () => ({ isDevice: true }));
mock.module("~/utils/constants", () => ({ EXPO_PROJECT_ID: "project" }));
mock.module("expo-network", () => ({
  addNetworkStateListener: (
    listener: (state: { isInternetReachable: boolean }) => void,
  ) => {
    network.add(listener);
    return { remove: () => network.delete(listener) };
  },
}));
// Replaces the suite-wide mock, so keep its exports for later test files.
mock.module("expo-notifications", () => ({
  dismissAllNotificationsAsync: async () => undefined,
  getExpoPushTokenAsync: acquire,
  addPushTokenListener: (listener: (token: DevicePushToken) => void) => {
    rotation.add(listener);
    return { remove: () => rotation.delete(listener) };
  },
}));

const { usePushTokenRegistration } = await import("./usePushTokenRegistration");
let renderer: ReactTestRenderer | undefined;
let latest: string | null = null;
const requests: string[] = [];
let unavailable = false;
let fetchMock = spyOn(globalThis, "fetch");
let errorLog = spyOn(console, "error");
function Harness({ sessionId }: { sessionId: string | null }) {
  latest = usePushTokenRegistration(sessionId);
  return null;
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
async function show(sessionId: string | null) {
  await act(async () => {
    const tree = createElement(Harness, { sessionId });
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
  await settle();
}

beforeEach(() => {
  fetchMock = spyOn(globalThis, "fetch");
  errorLog = spyOn(console, "error");
  requests.length = 0;
  unavailable = false;
  permission.mockReset().mockResolvedValue({ status: "granted" });
  acquire.mockReset().mockResolvedValue({ data: "device-token" });
  errorLog.mockImplementation(() => {});
  fetchMock.mockImplementation(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push(String(init?.body));
      if (unavailable) throw new Error("offline");
      return Response.json([
        {
          result: {
            data: { json: { success: true, tokenId: "registered" } },
          },
        },
      ]);
    },
  );
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  fetchMock.mockRestore();
  errorLog.mockRestore();
  expect(network.size).toBe(0);
  expect(rotation.size).toBe(0);
  expect(native.appListeners.size).toBe(0);
});

test("restored and switched sessions register independently, logout acquires nothing", async () => {
  await show("session-a");
  expect(requests).toHaveLength(1);
  await show(null);
  expect(acquire).toHaveBeenCalledTimes(1);
  expect(latest).toBeNull();
  await show("session-b");
  expect(requests).toHaveLength(2);
  expect(latest).toBe("device-token");
});

test("a late token from the previous session cannot register after switching", async () => {
  const pending = Promise.withResolvers<{ data: string }>();
  acquire.mockReturnValueOnce(pending.promise);
  await show("session-a");
  await show("session-b");
  expect(requests).toHaveLength(1);
  await act(async () => pending.resolve({ data: "old-token" }));
  await settle();
  expect(requests).toHaveLength(1);
  expect(latest).toBe("device-token");
});

test("registration failure retries on foreground and connectivity recovery", async () => {
  unavailable = true;
  await show("session-a");
  expect(latest).toBeNull();
  unavailable = false;
  await act(async () => {
    for (const listener of native.appListeners) listener("active");
  });
  await settle();
  expect(latest).toBe("device-token");
  await act(async () => {
    for (const listener of network) listener({ isInternetReachable: true });
  });
  await settle();
  expect(requests).toHaveLength(3);
});

test("token rotation uses the supplied native token without reacquiring it", async () => {
  await show("session-a");
  acquire.mockResolvedValueOnce({ data: "rotated-token" });
  const nativeToken: DevicePushToken = {
    type: "android",
    data: "native-token",
  };
  await act(async () => {
    for (const listener of rotation) listener(nativeToken);
  });
  await settle();
  expect(acquire).toHaveBeenLastCalledWith({
    projectId: "project",
    devicePushToken: nativeToken,
  });
  expect(latest).toBe("rotated-token");
  expect(requests).toHaveLength(2);
});

test("permission changes are picked up on foreground without requesting permission", async () => {
  permission.mockResolvedValueOnce({ status: "denied" });
  await show("session-a");
  expect(acquire).not.toHaveBeenCalled();
  await act(async () => {
    for (const listener of native.appListeners) listener("active");
  });
  await settle();
  expect(requests).toHaveLength(1);
});

test("an Expo failure cannot block another session or require work on logout", async () => {
  acquire.mockRejectedValueOnce(new Error("Firebase unavailable"));
  await show("session-a");
  await show(null);
  expect(acquire).toHaveBeenCalledTimes(1);
  await show("session-b");
  expect(requests).toHaveLength(1);
});
