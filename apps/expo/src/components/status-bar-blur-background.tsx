import type { BlurViewProps } from "expo-blur";
import React from "react";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";

const StatusBarBlurBackgroundImpl = ({
  style,
  ...props
}: BlurViewProps): React.ReactElement | null => {
  const insets = useSafeAreaInsets();

  if (Platform.OS !== "ios") return null;

  const styles = StyleSheet.create({
    statusBarBackground: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: insets.top,
    },
  });

  return (
    <BlurView
      style={[styles.statusBarBackground, style]}
      intensity={25}
      tint="light"
      {...props}
    />
  );
};

export const StatusBarBlurBackground = React.memo(StatusBarBlurBackgroundImpl);
