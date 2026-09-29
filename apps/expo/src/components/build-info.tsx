import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import Constants from "expo-constants";

import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";

import { SettingsRow } from "~/components/settings-group";
import { Text } from "~/components/ui/text";
import { getBaseUrl } from "~/utils/base-url";

function getEnvVars() {
  const envVarMap: Record<string, string> = {
    EXPO_PUBLIC_API_URL: "API Server",
    EXPO_PUBLIC_POSTHOG_API_KEY: "PostHog API Key",
    EXPO_PUBLIC_POSTHOG_HOST: "PostHog Host",
    EXPO_PUBLIC_ALLOW_SELF_MESSAGES: "Allow Self Messages",
    EXPO_PUBLIC_ENABLE_BACKGROUND_UPLOAD_TEST_PAGE:
      "Background Upload Test Page",
  };

  const envVars = Object.entries(process.env)
    .filter(([key]) => key.startsWith("EXPO_PUBLIC_"))
    .map(([key, value]) => ({
      key: envVarMap[key] ?? key,
      value: (value as string | undefined) ?? "undefined",
    }));

  envVars.push({
    key: "API Server",
    value: getBaseUrl(),
  });

  return envVars;
}

/** Version row. Triple-tap opens the environment dialog. */
export function BuildInfo() {
  const tapCount = useRef(0);
  const tapTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const [showDialog, setShowDialog] = useState(false);

  function handleTap() {
    if (tapTimeout.current) {
      clearTimeout(tapTimeout.current);
    }
    tapCount.current += 1;
    if (tapCount.current === 3) {
      setShowDialog(true);
      tapCount.current = 0;
    } else {
      tapTimeout.current = setTimeout(() => {
        tapCount.current = 0;
      }, 500);
    }
  }

  const buildNumber = Constants.expoConfig?.version ?? "1.0.0";
  const nativeBuildVersion =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode ??
    "1";

  return (
    <>
      <SettingsRow
        icon="information-circle"
        label="App version"
        end={{ kind: "value", value: `${buildNumber} (${nativeBuildVersion})` }}
        onPress={handleTap}
      />

      <Dialog isOpen={showDialog} onOpenChange={setShowDialog}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Close />
            <Dialog.Title>Environment</Dialog.Title>
            <Dialog.Description>
              Current environment configuration
            </Dialog.Description>
            <ScrollView className="max-h-96">
              <View className="bg-surface-secondary overflow-hidden rounded-lg">
                {getEnvVars().map((item, index) => (
                  <View
                    key={item.key}
                    className={`p-3 ${
                      index % 2 === 0 ? "bg-default/50" : "bg-transparent"
                    }`}
                  >
                    <Text className="text-xs font-semibold text-foreground">
                      {item.key}
                    </Text>
                    <Text className="mt-1 text-xs text-muted">
                      {item.value}
                    </Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <View className="flex-row justify-end pt-4">
              <Button size="sm" onPress={() => setShowDialog(false)}>
                Close
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </>
  );
}
