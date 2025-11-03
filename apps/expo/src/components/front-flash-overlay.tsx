import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

interface FrontFlashOverlayProps {
  isActive: boolean;
}

export function FrontFlashOverlay({ isActive }: FrontFlashOverlayProps) {
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      // Use withSequence to chain animations properly
      opacity.value = withSequence(
        withTiming(1, { duration: 50 }), // Flash on very quickly
        withTiming(1, { duration: 300 }), // Hold at full brightness longer for photo capture
        withTiming(0, { duration: 200 }) // Then fade out
      );
    }
  }, [isActive, opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  return (
    <Reanimated.View
      style={[styles.overlay, animatedStyle]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "white",
    zIndex: 9999,
  },
});
