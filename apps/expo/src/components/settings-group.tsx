import type { ComponentProps, ReactNode } from "react";
import { Children } from "react";
import { Pressable, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native/hooks";
import { Switch } from "heroui-native/switch";

import { Text } from "~/components/ui/text";
import { cn } from "~/lib/utils";

/** Rounded card of `SettingsRow`s separated by hairlines, with an optional header. */
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
        <Text accessibilityRole="header" className="px-1 text-sm text-muted">
          {title}
        </Text>
      )}
      <View className="bg-surface overflow-hidden rounded-2xl">
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 && <View className="bg-separator ml-4 h-px" />}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

type SettingsRowEnd =
  | { kind: "none" }
  | { kind: "navigate"; value?: string }
  | { kind: "external" }
  | { kind: "value"; value: string }
  | {
      kind: "switch";
      value: boolean;
      onChange: (value: boolean) => void;
    };

/** One settings row. Every row shares the same height and label style. */
export function SettingsRow({
  icon,
  label,
  description,
  alert,
  end = { kind: "none" },
  tone = "default",
  disabled = false,
  onPress,
}: {
  icon?: ComponentProps<typeof Ionicons>["name"];
  label: string;
  description?: string;
  /** Error shown under the label and announced to screen readers. */
  alert?: string;
  end?: SettingsRowEnd;
  tone?: "default" | "danger";
  disabled?: boolean;
  onPress?: () => void;
}) {
  const [foregroundColor, mutedColor, dangerColor] = useThemeColor([
    "foreground",
    "muted",
    "danger",
  ]);
  const body = (
    <>
      {icon && (
        <Ionicons
          name={icon}
          size={22}
          color={tone === "danger" ? dangerColor : foregroundColor}
        />
      )}
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
      {(end.kind === "value" || end.kind === "navigate") && end.value && (
        <Text
          numberOfLines={1}
          className="shrink text-sm tabular-nums text-muted"
        >
          {end.value}
        </Text>
      )}
      {end.kind === "navigate" && (
        <Ionicons name="chevron-forward" size={18} color={mutedColor} />
      )}
      {end.kind === "external" && (
        <Ionicons name="open-outline" size={18} color={mutedColor} />
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
    "min-h-14 flex-row items-center gap-4 px-4 py-3",
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
