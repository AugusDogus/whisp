import { View } from "react-native";

import { Switch } from "heroui-native/switch";

import { SettingsGroup } from "~/components/settings-group";
import { Text } from "~/components/ui/text";
import { isPreviewApp, usePreviewSettings } from "~/hooks/usePreviewSettings";

export function PreviewSettings() {
  const { allowSelfMessages, setAllowSelfMessages, error } =
    usePreviewSettings();
  if (!isPreviewApp) return null;

  return (
    <SettingsGroup title="Developer settings">
      <View className="flex-row items-center gap-4 px-4 py-3">
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
        <Text
          accessibilityRole="alert"
          className="text-danger px-4 py-3 text-sm"
        >
          {error}
        </Text>
      )}
    </SettingsGroup>
  );
}
