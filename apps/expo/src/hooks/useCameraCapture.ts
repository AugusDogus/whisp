import type { useSharedValue } from "react-native-reanimated";
import type { Camera, PhotoFile, VideoFile } from "react-native-vision-camera";
import { useCallback, useRef } from "react";

import { useRecording } from "~/contexts/RecordingContext";

export type CaptureState = "idle" | "photo" | "recording";
export type CaptureSource = "button" | "volume";

interface UseCameraCaptureProps {
  camera: React.RefObject<Camera | null>;
  flash: "off" | "on";
  onMediaCaptured: (
    media: PhotoFile | VideoFile,
    type: "photo" | "video",
  ) => void;
  isPressingButton: ReturnType<typeof useSharedValue<boolean>>;
  setIsPressingButton: (isPressed: boolean) => void;
  cameraPosition: "front" | "back";
  onTriggerFrontFlash: () => void;
}

export function useCameraCapture({
  camera,
  flash,
  onMediaCaptured,
  isPressingButton,
  setIsPressingButton,
  cameraPosition,
  onTriggerFrontFlash,
}: UseCameraCaptureProps) {
  const { setIsRecording } = useRecording();
  const captureState = useRef<CaptureState>("idle");
  const captureSource = useRef<CaptureSource>("button");
  const recordingStartTime = useRef<number>(0);
  const photoAnimationTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Core photo capture logic
  const takePhoto = useCallback(
    async (source: CaptureSource = "button") => {
      try {
        if (camera.current == null) throw new Error("Camera ref is null!");
        if (captureState.current !== "idle") {
          return;
        }

        captureState.current = "photo";
        captureSource.current = source;

        // Set animation state
        isPressingButton.value = true;
        setIsPressingButton(true);

        // Start with snappy timeout - will be canceled if transitioning to video
        photoAnimationTimeout.current = setTimeout(() => {
          if (captureState.current === "photo") {
            isPressingButton.value = false;
            setIsPressingButton(false);
            captureState.current = "idle";
          }
          photoAnimationTimeout.current = null;
        }, 180); // Safely before auto-repeat (which starts ~200ms+), still snappy

        // Trigger front flash if using front camera with flash enabled
        const useFrontFlash = cameraPosition === "front" && flash === "on";
        if (useFrontFlash) {
          onTriggerFrontFlash();
          // Wait for the flash to reach peak brightness before capturing
          // 100ms: 50ms fade in + 50ms into the hold period = peak brightness
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const photo = await camera.current.takePhoto({
          flash: useFrontFlash ? "off" : flash, // Use hardware flash only for back camera
          enableShutterSound: false,
        });

        onMediaCaptured(photo, "photo");
      } catch (e) {
        console.error("Failed to take photo!", e);
        // Reset state on error
        captureState.current = "idle";
        isPressingButton.value = false;
        setIsPressingButton(false);
      }
    },
    [
      camera,
      flash,
      onMediaCaptured,
      isPressingButton,
      setIsPressingButton,
      cameraPosition,
      onTriggerFrontFlash,
    ],
  );

  // Core recording start logic
  const startRecording = useCallback(
    (source: CaptureSource = "button") => {
      try {
        if (camera.current == null) throw new Error("Camera ref is null!");
        if (captureState.current === "recording") {
          return;
        }

        // Transition from photo to recording if needed
        if (captureState.current === "photo") {
          // Cancel photo animation reset to prevent fill→unfill→refill
          if (photoAnimationTimeout.current) {
            clearTimeout(photoAnimationTimeout.current);
            photoAnimationTimeout.current = null;
          }
        }

        captureState.current = "recording";
        captureSource.current = source;
        recordingStartTime.current = Date.now();

        // Ensure animation stays active
        isPressingButton.value = true;
        setIsPressingButton(true);

        // Update global recording state
        setIsRecording(true);

        // Front camera doesn't support hardware flash for video, so disable it
        const useFrontFlash = cameraPosition === "front" && flash === "on";

        camera.current.startRecording({
          flash: useFrontFlash ? "off" : flash, // Use hardware flash only for back camera
          onRecordingError: (error) => {
            if (error.code !== "capture/recording-canceled") {
              console.error("Recording failed!", error);
            }
            // Reset state on error
            captureState.current = "idle";
            isPressingButton.value = false;
            setIsPressingButton(false);
            setIsRecording(false);
          },
          onRecordingFinished: (video) => {
            onMediaCaptured(video, "video");
            // Reset state when recording finishes (for volume keys that don't call stopRecording)
            captureState.current = "idle";
            isPressingButton.value = false;
            setIsPressingButton(false);
            setIsRecording(false);
          },
        });
      } catch (e) {
        console.error("Failed to start recording!", e);
        // Reset state on error
        captureState.current = "idle";
        isPressingButton.value = false;
        setIsPressingButton(false);
        setIsRecording(false);
      }
    },
    [
      camera,
      flash,
      onMediaCaptured,
      isPressingButton,
      setIsPressingButton,
      setIsRecording,
      cameraPosition,
    ],
  );

  // Core recording stop logic
  const stopRecording = useCallback(async () => {
    try {
      if (camera.current == null) throw new Error("Camera ref is null!");
      if (captureState.current !== "recording") {
        return;
      }

      const recordingDuration = Date.now() - recordingStartTime.current;
      const minRecordingTime = 500; // Minimum 500ms recording

      if (recordingDuration >= minRecordingTime) {
        await camera.current.stopRecording();
      } else {
        // Too short - schedule stop after minimum time
        const remainingTime = minRecordingTime - recordingDuration;
        setTimeout(() => {
          if (captureState.current === "recording") {
            void camera.current?.stopRecording();
          }
        }, remainingTime);
      }

      // Reset state after recording stops
      setTimeout(() => {
        if (captureState.current === "recording") {
          captureState.current = "idle";
          isPressingButton.value = false;
          setIsPressingButton(false);
          setIsRecording(false);
        }
      }, 150);
    } catch (e) {
      console.error("Failed to stop recording!", e);
      // Reset state on error
      captureState.current = "idle";
      isPressingButton.value = false;
      setIsPressingButton(false);
      setIsRecording(false);
    }
  }, [camera, isPressingButton, setIsPressingButton, setIsRecording]);

  // Cancel recording (for photo/video conflicts)
  const cancelRecording = useCallback(async () => {
    try {
      if (camera.current == null) throw new Error("Camera ref is null!");
      if (captureState.current !== "recording") {
        return;
      }
      await camera.current.cancelRecording();

      // Reset state
      captureState.current = "idle";
    } catch (e) {
      console.error("Failed to cancel recording!", e);
      // Reset state on error
      captureState.current = "idle";
    }
  }, [camera]);

  // Force reset state (for broken state recovery)
  const forceReset = useCallback(() => {
    console.log("Force resetting capture state");

    // Clear any timeouts
    if (photoAnimationTimeout.current) {
      clearTimeout(photoAnimationTimeout.current);
      photoAnimationTimeout.current = null;
    }

    // Try to stop recording if active
    if (captureState.current === "recording" && camera.current) {
      void camera.current.stopRecording().catch(() => {
        // Ignore errors during force reset
      });
    }

    // Reset all state
    captureState.current = "idle";
    isPressingButton.value = false;
    setIsPressingButton(false);
    setIsRecording(false);
  }, [camera, isPressingButton, setIsPressingButton, setIsRecording]);

  // State queries
  const isIdle = useCallback(() => captureState.current === "idle", []);
  const isCapturingPhoto = useCallback(
    () => captureState.current === "photo",
    [],
  );
  const isRecording = useCallback(
    () => captureState.current === "recording",
    [],
  );
  const getCurrentState = useCallback(() => captureState.current, []);
  const getCurrentSource = useCallback(() => captureSource.current, []);

  return {
    // Actions
    takePhoto,
    startRecording,
    stopRecording,
    cancelRecording,
    forceReset,

    // State queries
    isIdle,
    isCapturingPhoto,
    isRecording,
    getCurrentState,
    getCurrentSource,
  };
}
