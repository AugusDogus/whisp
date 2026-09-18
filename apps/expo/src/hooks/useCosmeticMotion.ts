import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

import { useIsForeground } from "./useIsForeground";

export function useCosmeticMotion(visible: boolean): boolean {
  const foreground = useIsForeground();
  // Keep the first frame until the system preference has been read.
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let current = true;
    let receivedChange = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        receivedChange = true;
        setReducedMotion(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (current && !receivedChange) setReducedMotion(enabled);
      })
      .catch((error: unknown) => {
        console.warn(
          "Could not read reduced-motion preference; profile animations remain paused",
          error,
        );
      });
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return visible && foreground && !reducedMotion;
}
