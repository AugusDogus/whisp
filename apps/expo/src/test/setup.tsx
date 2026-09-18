/// <reference lib="es2024.promise" />
/// <reference types="bun-types/test" />
import { useEffect } from "react";

import type { ImageProps } from "expo-image";

import { beforeEach, mock } from "bun:test";

// Install native boundaries once for the whole suite. Tests reset state, not modules.
export const native = {
  preference: Promise.withResolvers<boolean>(),
  appState: "active",
  motionListeners: new Set<(enabled: boolean) => void>(),
  appListeners: new Set<(state: string) => void>(),
};
export const images = new Set<ImageProps>();
function ImageStub(props: ImageProps) {
  useEffect(() => {
    images.add(props);
    return () => {
      images.delete(props);
    };
  }, [props]);
  return null;
}

mock.module("react-native", () => ({
  View: "view",
  Text: "text",
  I18nManager: { isRTL: false },
  StyleSheet: {
    absoluteFill: { position: "absolute" },
    create: <T,>(styles: T) => styles,
  },
  Platform: {
    OS: "android",
    select: (options: { android?: unknown; default?: unknown }) =>
      options.android ?? options.default,
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => native.preference.promise,
    addEventListener: (
      _event: string,
      callback: (enabled: boolean) => void,
    ) => {
      native.motionListeners.add(callback);
      return { remove: () => native.motionListeners.delete(callback) };
    },
  },
  AppState: {
    get currentState() {
      return native.appState;
    },
    addEventListener: (_event: string, callback: (state: string) => void) => {
      native.appListeners.add(callback);
      return { remove: () => native.appListeners.delete(callback) };
    },
  },
}));
mock.module("expo-image", () => ({ Image: ImageStub }));
mock.module("~/utils/auth", () => ({
  authClient: { getCookie: () => "test-session" },
}));
mock.module("~/utils/base-url", () => ({
  getBaseUrl: () => "http://localhost:3000",
}));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
beforeEach(() => {
  native.preference = Promise.withResolvers<boolean>();
  native.appState = "active";
});
