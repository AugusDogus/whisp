import type { ReactNode } from "react";
import { Pressable, ScrollView, useColorScheme, View } from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";

export function SettingsPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => navigation.goBack()}
          className="size-12 items-center justify-center rounded-full active:opacity-70"
        >
          <Ionicons
            name="arrow-back"
            size={24}
            color={colorScheme === "dark" ? "#fff" : "#000"}
          />
        </Pressable>
        <Text
          accessibilityRole="header"
          className="flex-1 text-lg font-semibold"
        >
          {title}
        </Text>
      </View>
      <ScrollView contentContainerClassName="gap-4 px-4 pb-6">
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
