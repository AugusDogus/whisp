import type { useSharedValue } from "react-native-reanimated";
import type { Camera, PhotoFile, VideoFile } from "react-native-vision-camera";
import { useCallback, useRef } from "react";

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
}

export function useCameraCapture({
  camera,
  flash,
  onMediaCaptured,
  isPressingButton,
  setIsPressingButton,
}: UseCameraCaptureProps) {
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

        const photo = await camera.current.takePhoto({
          flash: flash,
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
    [camera, flash, onMediaCaptured, isPressingButton, setIsPressingButton],
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

        camera.current.startRecording({
          flash: flash,
          onRecordingError: (error) => {
            if (error.code !== "capture/recording-canceled") {
              console.error("Recording failed!", error);
            }
            // Reset state on error
            captureState.current = "idle";
            isPressingButton.value = false;
            setIsPressingButton(false);
          },
          onRecordingFinished: (video) => {
            onMediaCaptured(video, "video");
            // Reset state when recording finishes (for volume keys that don't call stopRecording)
            captureState.current = "idle";
            isPressingButton.value = false;
            setIsPressingButton(false);
          },
        });
      } catch (e) {
        console.error("Failed to start recording!", e);
        // Reset state on error
        captureState.current = "idle";
        isPressingButton.value = false;
        setIsPressingButton(false);
      }
    },
    [camera, flash, onMediaCaptured, isPressingButton, setIsPressingButton],
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
        }
      }, 150);
    } catch (e) {
      console.error("Failed to stop recording!", e);
      // Reset state on error
      captureState.current = "idle";
      isPressingButton.value = false;
      setIsPressingButton(false);
    }
  }, [camera, isPressingButton, setIsPressingButton]);

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

    // State queries
    isIdle,
    isCapturingPhoto,
    isRecording,
    getCurrentState,
    getCurrentSource,
  };
}
