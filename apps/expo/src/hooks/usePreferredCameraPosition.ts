import { useCallback, useState } from "react";
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

export function usePreferredCameraPosition(): [
  "front" | "back",
  (position: "front" | "back") => void,
] {
  const [storedPosition, setStoredPosition] = useStorageState(
    "camera.preferredPosition",
  );

  const position: "front" | "back" =
    storedPosition === "front" ? "front" : "back";

  const setPosition = useCallback(
    (newPosition: "front" | "back") => {
      setStoredPosition(newPosition);
    },
    [setStoredPosition],
  );

  return [position, setPosition];
}
