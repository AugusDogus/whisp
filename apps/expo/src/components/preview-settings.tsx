import { View } from "react-native";

import { Switch } from "heroui-native/switch";

import { Text } from "~/components/ui/text";
import { isPreviewApp, usePreviewSettings } from "~/hooks/usePreviewSettings";

export function PreviewSettings() {
  const { allowSelfMessages, setAllowSelfMessages, error } =
    usePreviewSettings();
  if (!isPreviewApp) return null;

  return (
    <View className="bg-surface gap-4 rounded-xl p-4">
      <Text className="text-base font-semibold">Developer settings</Text>
      <View className="flex-row items-center gap-4">
        <View className="flex-1 gap-1">
          <Text className="text-sm">Send to myself</Text>
          <Text className="text-xs text-muted">
            Show Me (testing) when choosing recipients. Saved on this device.
          </Text>
        </View>
        <Switch
          accessibilityLabel="Send to myself"
          isSelected={allowSelfMessages}
          onSelectedChange={setAllowSelfMessages}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" className="text-danger text-sm">
          {error}
        </Text>
      )}
    </View>
  );
}
