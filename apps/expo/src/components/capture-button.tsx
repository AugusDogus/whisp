import type { ViewProps } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { Camera, PhotoFile, VideoFile } from "react-native-vision-camera";
import React, { useCallback, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { useCameraCapture } from "~/hooks/useCameraCapture";
import { CAPTURE_BUTTON_SIZE } from "~/utils/constants";

const START_RECORDING_DELAY = 200;
const BORDER_WIDTH = CAPTURE_BUTTON_SIZE * 0.1;

interface Props extends ViewProps {
  camera: React.RefObject<Camera | null>;
  onMediaCaptured: (
    media: PhotoFile | VideoFile,
    type: "photo" | "video",
  ) => void;

  minZoom: number;
  maxZoom: number;
  cameraZoom: SharedValue<number>;

  flash: "off" | "on";

  enabled: boolean;

  setIsPressingButton: (isPressingButton: boolean) => void;
}

export interface CaptureButtonRef {
  startCapture: () => void;
  endCapture: () => void;
  startRecording: () => void;
  takePhoto: () => void;
  cancelRecording: () => void;
}

const CaptureButtonComponent = React.forwardRef<CaptureButtonRef, Props>(
  (
    {
      camera,
      onMediaCaptured,
      minZoom,
      maxZoom,
      cameraZoom,
      flash,
      enabled,
      setIsPressingButton,
      style,
      ...props
    },
    ref,
  ): React.ReactElement => {
    const pressDownDate = useRef<Date | undefined>(undefined);
    const isPressingButton = useSharedValue(false);

    // Initialize capture hook (keeping existing logic for now)
    const captureHook = useCameraCapture({
      camera,
      flash,
      onMediaCaptured,
      isPressingButton,
      setIsPressingButton,
    });

    //#region Unified gesture handler
    const panStartY = useSharedValue(0);
    const panOffsetY = useSharedValue(0);
    const initialTouchY = useSharedValue(0);

    // Simple capture methods for volume key integration
    const startCapture = useCallback(() => {
      if (!enabled) return;
      // Simulate touch down for gesture compatibility
      isPressingButton.value = true;
      pressDownDate.current = new Date();
      setIsPressingButton(true);
    }, [enabled, isPressingButton, setIsPressingButton]);

    const endCapture = useCallback(() => {
      if (!enabled) return;

      // Check if this was a quick tap or hold
      if (pressDownDate.current) {
        const diff = Date.now() - pressDownDate.current.getTime();
        pressDownDate.current = undefined;

        if (diff < START_RECORDING_DELAY) {
          void captureHook.takePhoto("button");
        } else {
          void captureHook.stopRecording();
        }
      } else {
        // Volume key scenario - just stop recording
        void captureHook.stopRecording();
      }

      // Reset pan state
      panStartY.value = 0;
      panOffsetY.value = 0;
      initialTouchY.value = 0;
    }, [enabled, captureHook, panStartY, panOffsetY, initialTouchY]);

    // Method for immediate recording start (for volume keys) - now using hook
    const startRecordingOnly = useCallback(() => {
      if (!enabled) return;

      // Use the centralized capture hook
      void captureHook.startRecording("button");
    }, [enabled, captureHook]);

    // Method for immediate photo (for volume keys) - now using hook
    const takePhotoOnly = useCallback(() => {
      if (!enabled) return;

      // Use the centralized capture hook
      void captureHook.takePhoto("button");
    }, [enabled, captureHook]);

    // Expose methods via ref
    React.useImperativeHandle(
      ref,
      () => ({
        startCapture,
        endCapture,
        startRecording: startRecordingOnly,
        takePhoto: takePhotoOnly,
        cancelRecording: captureHook.cancelRecording,
      }),
      [
        startCapture,
        endCapture,
        startRecordingOnly,
        takePhotoOnly,
        captureHook.cancelRecording,
      ],
    );

    const unifiedGesture = Gesture.Manual()
      .runOnJS(true)
      .onTouchesDown((event) => {
        // Touch started - begin recording logic and store initial position
        isPressingButton.value = true;
        const now = Date.now();
        pressDownDate.current = new Date(now);

        // Store initial touch position
        if (event.allTouches.length === 1) {
          initialTouchY.value = event.allTouches[0]?.absoluteY ?? 0;
        }

        // Schedule recording start after delay
        setTimeout(() => {
          if (
            pressDownDate.current &&
            pressDownDate.current.getTime() === now
          ) {
            void captureHook.startRecording("button");
          }
        }, START_RECORDING_DELAY);
        setIsPressingButton(true);
      })
      .onTouchesMove((event) => {
        "worklet";
        // Handle zoom during touch - only if there's significant movement
        if (event.allTouches.length === 1) {
          const touch = event.allTouches[0];
          const currentY = touch?.absoluteY ?? 0;

          // Only initialize and calculate zoom if there's any movement from initial touch
          const movementFromInitial = currentY - initialTouchY.value;

          if (Math.abs(movementFromInitial) > 0) {
            // Initialize pan values on first movement
            if (panStartY.value === 0) {
              panStartY.value = initialTouchY.value; // Use initial touch as reference
              panOffsetY.value = cameraZoom.value; // Store current zoom as baseline
            }

            // Enhanced zoom calculation with exponential curve and smooth dead zone
            const movementFromStart = currentY - panStartY.value;
            const maxMovement = 200; // 200px of movement = full zoom range
            const deadZone = 25; // Dead zone for smooth start

            // Smooth dead zone with continuous transition
            const absMovement = Math.abs(movementFromStart);
            let effectiveMovement = movementFromStart;

            if (absMovement < deadZone) {
              // Within dead zone: smooth cubic curve from 0 to deadZone
              const deadZoneRatio = absMovement / deadZone; // 0 to 1
              const smoothRatio = deadZoneRatio * deadZoneRatio * deadZoneRatio; // Cubic curve for smoothness
              effectiveMovement = movementFromStart * smoothRatio * 0.2; // Gentle scaling
            } else {
              // Beyond dead zone: continue smoothly from where dead zone left off
              const deadZoneEffect = deadZone * 0.2; // What the dead zone contributed at its boundary
              const beyondDeadZone = absMovement - deadZone; // Movement beyond dead zone
              effectiveMovement =
                Math.sign(movementFromStart) *
                (deadZoneEffect + beyondDeadZone);
            }

            // Normalize effective movement to -1 to 1 range
            const normalizedMovement = Math.max(
              -1,
              Math.min(1, effectiveMovement / maxMovement),
            );

            // Apply exponential curve for more natural zoom feel
            // Power of 0.6 gives more precision at low zoom, faster changes at high zoom
            const curvedMovement =
              Math.sign(normalizedMovement) *
              Math.pow(Math.abs(normalizedMovement), 0.6);

            // Convert curved movement back to zoom change
            const zoomChange = curvedMovement * (maxZoom - minZoom);

            // Apply zoom change to baseline zoom level
            const newZoom = panOffsetY.value - zoomChange; // Negative because up = zoom in

            cameraZoom.value = Math.max(minZoom, Math.min(maxZoom, newZoom));
          }
        }
      })
      .onTouchesUp(() => {
        // Touch ended - handle recording/photo logic
        try {
          if (pressDownDate.current == null) {
            throw new Error("PressDownDate ref .current was null!");
          }
          const now = new Date();
          const diff = now.getTime() - pressDownDate.current.getTime();
          pressDownDate.current = undefined;

          // Reset pan state and ensure zoom is stable
          panStartY.value = 0;
          panOffsetY.value = 0;
          initialTouchY.value = 0;

          if (diff < START_RECORDING_DELAY) {
            void captureHook.takePhoto("button");
          } else {
            void captureHook.stopRecording();
          }
        } finally {
          setTimeout(() => {
            isPressingButton.value = false;
            setIsPressingButton(false);
          }, 150);
        }
      });
    //#endregion

    const shadowStyle = useAnimatedStyle(
      () => ({
        transform: [
          {
            scale: withTiming(isPressingButton.value ? 1 : 0, {
              duration: 125,
              easing: Easing.inOut(Easing.ease),
            }),
          },
        ],
      }),
      [isPressingButton],
    );
    const buttonStyle = useAnimatedStyle(() => {
      let scale: number;
      if (enabled) {
        if (isPressingButton.value) {
          scale = withRepeat(
            withSpring(1, {
              stiffness: 100,
              damping: 1000,
            }),
            -1,
            true,
          );
        } else {
          scale = withSpring(0.9, {
            stiffness: 500,
            damping: 300,
          });
        }
      } else {
        scale = withSpring(0.6, {
          stiffness: 500,
          damping: 300,
        });
      }

      return {
        opacity: withTiming(enabled ? 1 : 0.3, {
          duration: 100,
          easing: Easing.linear,
        }),
        transform: [
          {
            scale: scale,
          },
        ],
      };
    }, [enabled, isPressingButton]);

    return (
      <GestureDetector gesture={unifiedGesture.enabled(enabled)}>
        <Reanimated.View {...props} style={[buttonStyle, style]}>
          <Reanimated.View style={styles.flex}>
            <Reanimated.View style={[styles.shadow, shadowStyle]} />
            <View style={styles.button} />
          </Reanimated.View>
        </Reanimated.View>
      </GestureDetector>
    );
  },
);

CaptureButtonComponent.displayName = "CaptureButton";

export const CaptureButton = React.memo(CaptureButtonComponent);

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  shadow: {
    position: "absolute",
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    backgroundColor: "#e34077",
  },
  button: {
    width: CAPTURE_BUTTON_SIZE,
    height: CAPTURE_BUTTON_SIZE,
    borderRadius: CAPTURE_BUTTON_SIZE / 2,
    borderWidth: BORDER_WIDTH,
    borderColor: "white",
  },
});
