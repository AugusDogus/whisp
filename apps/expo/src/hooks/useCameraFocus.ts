import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { GestureResponderEvent } from "react-native";
import type { Camera } from "react-native-vision-camera";

export function useCameraFocus(
  camera: RefObject<Camera | null>,
  supportsFocus: boolean | undefined,
) {
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFocusTap = useCallback(
    ({ nativeEvent: event }: GestureResponderEvent) => {
      if (!supportsFocus) return;

      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
      }

      focusTimeoutRef.current = setTimeout(() => {
        camera.current
          ?.focus({
            x: event.locationX,
            y: event.locationY,
          })
          .catch((error: unknown) => {
            if (
              error != null &&
              typeof error === "object" &&
              "code" in error &&
              error.code !== "capture/focus-canceled"
            ) {
              console.error("Focus error:", error);
            }
          });
      }, 100);
    },
    [supportsFocus, camera],
  );

  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
      }
    };
  }, []);

  return { onFocusTap };
}
