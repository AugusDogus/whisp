import type { CameraDevice } from "react-native-vision-camera";
import { useCallback, useMemo, useState } from "react";
import { useCameraDevices } from "react-native-vision-camera";
import * as SecureStore from "expo-secure-store";

// Simple storage state hook for SecureStore
function useStorageState(
  key: string,
): [string | null, (value: string | null) => void] {
  const [state, setState] = useState<string | null>(() => {
    // Synchronously get the value - SecureStore.getItem is sync
    try {
      return SecureStore.getItem(key);
    } catch {
      return null;
    }
  });

  const setValue = useCallback(
    (value: string | null) => {
      setState(value);
      if (value === null) {
        void SecureStore.deleteItemAsync(key);
      } else {
        void SecureStore.setItemAsync(key, value);
      }
    },
    [key],
  );

  return [state, setValue];
}

export function usePreferredCameraDevice(): [
  CameraDevice | undefined,
  (device: CameraDevice) => void,
] {
  const [preferredDeviceId, setPreferredDeviceId] = useStorageState(
    "camera.preferredDeviceId",
  );

  const set = useCallback(
    (device: CameraDevice) => {
      setPreferredDeviceId(device.id);
    },
    [setPreferredDeviceId],
  );

  const devices = useCameraDevices();
  const device = useMemo(
    () => devices.find((d) => d.id === preferredDeviceId),
    [devices, preferredDeviceId],
  );

  return [device, set];
}
