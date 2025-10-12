import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { cn } from "~/lib/utils";

function Skeleton({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Animated.View>) {
  const opacity = useSharedValue(0.5);

  opacity.value = withRepeat(
    withTiming(1, { duration: 1000, easing: Easing.ease }),
    -1,
    true,
  );

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      className={cn("rounded-md bg-accent", className)}
      style={animatedStyle}
      {...props}
    />
  );
}

export { Skeleton };
