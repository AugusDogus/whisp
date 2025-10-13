import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";

export default function ProfileScreen() {
  const { data: session } = authClient.useSession();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <SafeAreaView className="bg-background">
      <View className="h-full w-full">
        <View className="items-center px-4 py-3 pb-4">
          <Text className="text-lg font-semibold">Profile</Text>
        </View>

        <View className="flex-1 px-4">
          {/* Top section - Avatar and info */}
          <View className="items-center gap-4 pt-8">
            <View className="h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-secondary">
              {session?.user.image ? (
                <Image
                  source={{ uri: session.user.image }}
                  style={{ width: 96, height: 96 }}
                  contentFit="cover"
                />
              ) : (
                <Ionicons name="person" size={48} color="#666" />
              )}
            </View>

            <View className="items-center gap-1">
              <Text className="text-2xl font-bold">
                {session?.user.name ?? "User"}
              </Text>
              {session?.user.email && (
                <Text variant="muted" className="text-sm">
                  {session.user.email}
                </Text>
              )}
            </View>
          </View>

          {/* Cards section */}
          {!showSettings ? (
            <View className="mt-8 gap-3">
              {/* Friends Card */}
              <Pressable
                onPress={() => {
                  navigation.navigate("Main", {
                    screen: "Friends",
                  });
                }}
                className="rounded-lg bg-secondary p-4 active:opacity-70"
              >
                <View className="flex-row items-center gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Ionicons name="people" size={20} color="#666" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold">Friends</Text>
                    <Text variant="muted" className="text-xs">
                      Manage your connections
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#666" />
                </View>
              </Pressable>

              {/* Settings Card */}
              <Pressable
                onPress={() => setShowSettings(true)}
                className="rounded-lg bg-secondary p-4 active:opacity-70"
              >
                <View className="flex-row items-center gap-3">
                  <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Ionicons name="settings" size={20} color="#666" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold">Settings</Text>
                    <Text variant="muted" className="text-xs">
                      Customize your experience
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#666" />
                </View>
              </Pressable>
            </View>
          ) : (
            <SettingsPanel onBack={() => setShowSettings(false)} />
          )}

          {/* Bottom section - Sign out */}
          {!showSettings && (
            <View className="flex-1 justify-end pb-4">
              <Button
                variant="destructive"
                onPress={async () => {
                  console.log("[ProfileScreen] Signing out");
                  await authClient.signOut();
                }}
                className="w-full"
              >
                <Text>Sign Out</Text>
              </Button>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function SettingsPanel({ onBack }: { onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data: preferences } = trpc.notifications.getPreferences.useQuery(
    undefined,
    {
      // Use cached data immediately if available, fallback to defaults
      initialData: () =>
        utils.notifications.getPreferences.getData() ?? {
          notifyOnMessages: true,
          notifyOnFriendActivity: true,
        },
      // Still fetch in background to ensure fresh data
      staleTime: 0,
    },
  );
  const updatePreferences = trpc.notifications.updatePreferences.useMutation({
    onMutate: async (newPrefs) => {
      // Cancel outgoing refetches
      await utils.notifications.getPreferences.cancel();

      // Snapshot the previous value
      const previousPrefs = utils.notifications.getPreferences.getData();

      // Optimistically update to the new value
      utils.notifications.getPreferences.setData(undefined, (old) => {
        if (!old) return old;
        return {
          notifyOnMessages: old.notifyOnMessages,
          notifyOnFriendActivity: old.notifyOnFriendActivity,
          ...newPrefs,
        };
      });

      // Return context with the snapshot
      return { previousPrefs };
    },
    onError: (_err, _newPrefs, context) => {
      // Rollback to the previous value on error
      if (context?.previousPrefs) {
        utils.notifications.getPreferences.setData(
          undefined,
          context.previousPrefs,
        );
      }
    },
    onSettled: () => {
      // Refetch after mutation
      void utils.notifications.getPreferences.refetch();
    },
  });

  const handleToggle = (key: keyof typeof preferences) => {
    updatePreferences.mutate({
      [key]: !preferences[key],
    });
  };

  return (
    <View className="mt-8 flex-1 gap-3">
      {/* Back button */}
      <Pressable
        onPress={onBack}
        className="mb-2 flex-row items-center gap-2 active:opacity-70"
      >
        <Ionicons name="chevron-back" size={20} color="#666" />
        <Text className="text-base font-semibold">Back</Text>
      </Pressable>

      {/* Notifications Card */}
      <View className="rounded-lg bg-secondary p-4">
        <View className="flex-row items-center gap-3 pb-3">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Ionicons name="notifications" size={20} color="#666" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold">Notifications</Text>
            <Text variant="muted" className="text-xs">
              Manage push notifications
            </Text>
          </View>
        </View>
        <View className="gap-3 pt-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm">New whispers</Text>
            <Switch
              value={preferences.notifyOnMessages}
              onValueChange={() => handleToggle("notifyOnMessages")}
            />
          </View>
          <View className="flex-row items-center justify-between">
            <Text className="text-sm">Friend requests</Text>
            <Switch
              value={preferences.notifyOnFriendActivity}
              onValueChange={() => handleToggle("notifyOnFriendActivity")}
            />
          </View>
        </View>
      </View>

      {/* About Card */}
      <View className="rounded-lg bg-secondary p-4">
        <View className="flex-row items-center gap-3 pb-3">
          <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Ionicons name="information-circle" size={20} color="#666" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold">About</Text>
            <Text variant="muted" className="text-xs">
              App information and legal
            </Text>
          </View>
        </View>
        <View className="gap-3 pt-2">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm">Version</Text>
            <Text variant="muted" className="text-sm">
              1.0.0
            </Text>
          </View>
          <Pressable className="active:opacity-70">
            <Text className="text-sm text-primary">Terms of Service</Text>
          </Pressable>
          <Pressable className="active:opacity-70">
            <Text className="text-sm text-primary">Privacy Policy</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
