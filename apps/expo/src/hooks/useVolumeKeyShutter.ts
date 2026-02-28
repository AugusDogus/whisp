import type { RefObject } from "react";
import { useEffect } from "react";
import { VolumeManager } from "react-native-volume-manager";

import type { CaptureButtonRef } from "~/components/capture-button";

export function useVolumeKeyShutter(
  captureButtonRef: RefObject<CaptureButtonRef | null>,
  isActive: boolean,
  isCameraInitialized: boolean,
) {
  useEffect(() => {
    if (!isActive || !isCameraInitialized) return;

    let currentVolume = 0;
    let isVolumeKeyPressed = false;
    let photoTimeout: ReturnType<typeof setTimeout> | null = null;
    let releaseTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastKeyPressTime = 0;
    let isRestoringVolume = false;
    let isRecording = false;

    VolumeManager.getVolume()
      .then((result) => {
        currentVolume = result.volume;
      })
      .catch((error) => {
        console.error("Failed to get volume!", error);
      });

    void VolumeManager.showNativeVolumeUI({ enabled: false });

    const volumeListener = VolumeManager.addVolumeListener((result) => {
      const now = Date.now();

      if (Math.abs(result.volume - currentVolume) > 0.01) {
        if (isRecording && releaseTimeout) {
          clearTimeout(releaseTimeout);
          releaseTimeout = setTimeout(() => {
            if (isRecording) {
              isRecording = false;
              isVolumeKeyPressed = false;
              lastKeyPressTime = Date.now();
              captureButtonRef.current?.endCapture();
            }
          }, 100);
        }

        if (isRestoringVolume) return;
        if (now - lastKeyPressTime < 1000) return;

        if (!isVolumeKeyPressed) {
          isVolumeKeyPressed = true;

          photoTimeout = setTimeout(() => {
            if (isVolumeKeyPressed && !isRecording) {
              captureButtonRef.current?.takePhoto();
              isVolumeKeyPressed = false;
              lastKeyPressTime = Date.now();
            }
          }, 250);
        } else {
          if (!isRecording) {
            if (photoTimeout) {
              clearTimeout(photoTimeout);
              photoTimeout = null;
            }
            isRecording = true;
            captureButtonRef.current?.startRecording();
          }

          if (releaseTimeout) clearTimeout(releaseTimeout);
          releaseTimeout = setTimeout(() => {
            if (isRecording) {
              isRecording = false;
              isVolumeKeyPressed = false;
              lastKeyPressTime = Date.now();
              captureButtonRef.current?.endCapture();
            }
          }, 100);
        }

        isRestoringVolume = true;
        void VolumeManager.setVolume(currentVolume, { showUI: false });
        setTimeout(() => {
          isRestoringVolume = false;
        }, 100);
      }
    });

    return () => {
      volumeListener.remove();
      if (photoTimeout) clearTimeout(photoTimeout);
      if (releaseTimeout) clearTimeout(releaseTimeout);
      void VolumeManager.showNativeVolumeUI({ enabled: true });
    };
  }, [isActive, isCameraInitialized, captureButtonRef]);
}
