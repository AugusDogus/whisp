import type { SwitchProps } from "react-native";
import { Switch as RNSwitch } from "react-native";
import { useColorScheme } from "nativewind";

function Switch({ value, ...props }: SwitchProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  // Track colors matching the original switch component
  const trackColorOff = isDark
    ? "hsla(0, 0%, 14.9%, 0.8)" // input with 80% opacity (dark:bg-input/80)
    : "hsl(0, 0%, 89.8%)"; // input (bg-input)

  const trackColorOn = isDark ? "hsl(0, 0%, 98%)" : "hsl(0, 0%, 9%)"; // primary

  // Thumb colors: when on, use solid version of off track color; when off, use white/light
  const thumbColorOn = isDark
    ? "hsl(0, 0%, 14.9%)" // solid input color (no transparency)
    : "hsl(0, 0%, 89.8%)"; // solid input color

  const thumbColorOff = isDark
    ? "hsl(0, 0%, 98%)" // foreground (dark:bg-foreground)
    : "hsl(0, 0%, 100%)"; // background (bg-background)

  return (
    <RNSwitch
      value={value}
      trackColor={{
        false: trackColorOff,
        true: trackColorOn,
      }}
      thumbColor={value ? thumbColorOn : thumbColorOff}
      ios_backgroundColor={trackColorOff}
      {...props}
    />
  );
}

export { Switch };
