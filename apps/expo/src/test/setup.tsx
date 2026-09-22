/// <reference lib="es2024.promise" />
/// <reference types="bun-types/test" />
import { useEffect, useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import type { Image, ImageProps } from "expo-image";

import { beforeEach, mock } from "bun:test";

// Install native boundaries once for the whole suite. Tests reset state, not modules.
export const native = {
  preference: Promise.withResolvers<boolean>(),
  appState: "active",
  userId: null as string | null,
  sessionPending: false,
  motionListeners: new Set<(enabled: boolean) => void>(),
  appListeners: new Set<(state: string) => void>(),
};
export const images = new Set<ImageProps>();
export const imageMounts: (string | undefined)[] = [];
export const imagePlayback: { label: string | undefined; playing: boolean }[] =
  [];
function ImageStub(
  props: ImageProps & {
    ref?: Ref<Pick<Image, "startAnimating" | "stopAnimating">>;
  },
) {
  const initialLabel = useRef(props.accessibilityLabel);
  useImperativeHandle(
    props.ref,
    () => ({
      startAnimating: async () => {
        imagePlayback.push({ label: props.accessibilityLabel, playing: true });
      },
      stopAnimating: async () => {
        imagePlayback.push({ label: props.accessibilityLabel, playing: false });
      },
    }),
    [props.accessibilityLabel],
  );
  useEffect(() => {
    imageMounts.push(initialLabel.current);
  }, []);
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
  ScrollView: "scroll-view",
  Modal: "modal",
  Linking: { openURL: async () => undefined },
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
mock.module("expo-notifications", () => ({
  dismissAllNotificationsAsync: async () => undefined,
}));
mock.module("expo-splash-screen", () => ({ hideAsync: async () => undefined }));
mock.module("heroui-native/button", () => ({ Button: "button" }));
mock.module("~/components/styled", () => ({ SafeAreaView: "safe-area" }));
mock.module("~/utils/auth", () => ({
  authClient: {
    getCookie: () => "test-session",
    useSession: () => ({
      data: native.userId === null ? null : { user: { id: native.userId } },
      isPending: native.sessionPending,
    }),
  },
}));
mock.module("~/utils/base-url", () => ({
  getBaseUrl: () => "http://localhost:3000",
}));
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
beforeEach(() => {
  imageMounts.length = 0;
  imagePlayback.length = 0;
  native.preference = Promise.withResolvers<boolean>();
  native.appState = "active";
  native.userId = null;
  native.sessionPending = false;
});
