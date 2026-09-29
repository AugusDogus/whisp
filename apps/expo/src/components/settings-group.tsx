import type { ReactNode } from "react";
import { Children } from "react";
import { View } from "react-native";

import { Text } from "~/components/ui/text";

/** Rounded card whose children are single rows separated by hairlines. */
export function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
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
        {Children.toArray(children).map((child, index) => (
          <View key={index}>
            {index > 0 && <View className="bg-separator mx-4 h-px" />}
            {child}
          </View>
        ))}
      </View>
    </View>
  );
}
