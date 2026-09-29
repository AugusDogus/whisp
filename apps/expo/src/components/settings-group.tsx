import type { ReactNode } from "react";
import { Children } from "react";
import { Pressable, useColorScheme, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { Switch } from "heroui-native/switch";

import { Text } from "~/components/ui/text";
import { cn } from "~/lib/utils";

/** Rounded card whose children are `SettingsRow`s separated by hairlines. */
export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;
  return (
    <View className="gap-2">
      {title && (
        <Text
          accessibilityRole="header"
          className="px-1 text-sm font-semibold text-muted"
        >
          {title}
        </Text>
      )}
      <View className="bg-surface overflow-hidden rounded-xl">
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 && <View className="bg-separator mx-4 h-px" />}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

type SettingsRowEnd =
  | { kind: "none" }
  | { kind: "navigate" }
  | { kind: "external" }
  | { kind: "value"; value: string }
  | {
      kind: "switch";
      value: boolean;
      onChange: (value: boolean) => void;
    };

/** One settings row. Every row shares the same height and label style. */
export function SettingsRow({
  label,
  description,
  alert,
  end = { kind: "none" },
  tone = "default",
  disabled = false,
  onPress,
}: {
  label: string;
  description?: string;
  /** Error shown under the label and announced to screen readers. */
  alert?: string;
  end?: SettingsRowEnd;
  tone?: "default" | "danger";
  disabled?: boolean;
  onPress?: () => void;
}) {
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#aaa" : "#666";
  const body = (
    <>
      <View className="flex-1 gap-0.5">
        <Text className={cn("text-base", tone === "danger" && "text-danger")}>
          {label}
        </Text>
        {description && (
          <Text className="text-xs text-muted">{description}</Text>
        )}
        {alert && (
          <Text accessibilityRole="alert" className="text-danger text-xs">
            {alert}
          </Text>
        )}
      </View>
      {end.kind === "navigate" && (
        <Ionicons name="chevron-forward" size={18} color={iconColor} />
      )}
      {end.kind === "external" && (
        <Ionicons name="open-outline" size={18} color={iconColor} />
      )}
      {end.kind === "value" && (
        <Text className="text-base tabular-nums text-muted">{end.value}</Text>
      )}
      {end.kind === "switch" && (
        <Switch
          accessibilityLabel={label}
          isSelected={end.value}
          onSelectedChange={end.onChange}
        />
      )}
    </>
  );
  const className = cn(
    "min-h-14 flex-row items-center gap-3 px-4 py-3",
    disabled && "opacity-50",
  );

  if (!onPress) return <View className={className}>{body}</View>;
  return (
    <Pressable
      accessibilityRole={end.kind === "external" ? "link" : "button"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(className, "active:opacity-70")}
    >
      {body}
    </Pressable>
  );
}
