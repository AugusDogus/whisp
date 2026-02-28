import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { check, PERMISSIONS, request, RESULTS } from "react-native-permissions";

export function useCameraPermissions() {
  const [cameraPermission, setCameraPermission] = useState<string>(
    RESULTS.DENIED,
  );
  const [microphonePermission, setMicrophonePermission] = useState<string>(
    RESULTS.DENIED,
  );

  useEffect(() => {
    async function checkPermissions() {
      const cam = await check(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.CAMERA
          : PERMISSIONS.ANDROID.CAMERA,
      );
      const mic = await check(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.MICROPHONE
          : PERMISSIONS.ANDROID.RECORD_AUDIO,
      );
      setCameraPermission(cam);
      setMicrophonePermission(mic);
    }
    void checkPermissions();
  }, []);

  const requestPermissions = async () => {
    if (cameraPermission !== RESULTS.GRANTED) {
      const result = await request(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.CAMERA
          : PERMISSIONS.ANDROID.CAMERA,
      );
      setCameraPermission(result);
    }
    if (microphonePermission !== RESULTS.GRANTED) {
      const result = await request(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.MICROPHONE
          : PERMISSIONS.ANDROID.RECORD_AUDIO,
      );
      setMicrophonePermission(result);
    }
  };

  return { cameraPermission, microphonePermission, requestPermissions };
}
