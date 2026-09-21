import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Pressable, useColorScheme, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { SettingsPage } from "~/components/settings-page";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";

export default function SettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#aaa" : "#666";
  return (
    <SettingsPage title="Settings">
      <Text accessibilityRole="header" className="text-base font-semibold">
        Security
      </Text>
      <View className="gap-3">
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate("Devices")}
          className="bg-surface flex-row items-center gap-3 rounded-xl p-4 active:opacity-70"
        >
          <View className="flex-1 gap-1">
            <Text className="text-base font-semibold">Devices</Text>
            <Text className="text-sm text-muted">
              Manage which devices receive your whisps
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={iconColor} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate("EncryptionRecovery")}
          className="bg-surface flex-row items-center gap-3 rounded-xl p-4 active:opacity-70"
        >
          <View className="flex-1 gap-1">
            <Text className="text-base font-semibold">Encryption recovery</Text>
            <Text className="text-sm text-muted">
              Get help with missing or damaged encryption keys
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={iconColor} />
        </Pressable>
      </View>
    </SettingsPage>
  );
}
