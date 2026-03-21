import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useRef, useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  useColorScheme,
  View,
} from "react-native";

import Constants from "expo-constants";
import { Image } from "expo-image";

import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { Switch } from "heroui-native/switch";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";

export default function ProfileScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const colorScheme = useColorScheme();
  const iconColor = colorScheme === "dark" ? "#aaa" : "#666";
  const utils = trpc.useUtils();
  const isBackgroundUploadTestEnabled =
    process.env.EXPO_PUBLIC_ENABLE_BACKGROUND_UPLOAD_TEST_PAGE === "true";
  const { data: preferences } = trpc.notifications.getPreferences.useQuery(
    undefined,
    {
      initialData: () =>
        utils.notifications.getPreferences.getData() ?? {
          notifyOnMessages: true,
          notifyOnFriendActivity: true,
        },
      staleTime: 0,
    },
  );
  const updatePreferences = trpc.notifications.updatePreferences.useMutation({
    onMutate: async (newPrefs) => {
      await utils.notifications.getPreferences.cancel();
      const previousPrefs = utils.notifications.getPreferences.getData();
      utils.notifications.getPreferences.setData(undefined, (old) => {
        if (!old) return old;
        return {
          notifyOnMessages: old.notifyOnMessages,
          notifyOnFriendActivity: old.notifyOnFriendActivity,
          ...newPrefs,
        };
      });
      return { previousPrefs };
    },
    onError: (_err, _newPrefs, context) => {
      if (context?.previousPrefs) {
        utils.notifications.getPreferences.setData(
          undefined,
          context.previousPrefs,
        );
      }
    },
    onSettled: () => {
      void utils.notifications.getPreferences.refetch();
    },
  });

  const deleteAccount = trpc.auth.deleteAccount.useMutation();

  const handleToggle = (key: keyof typeof preferences) => {
    updatePreferences.mutate({
      [key]: !preferences[key],
    });
  };

  const handleDeleteAccount = async () => {
    await deleteAccount.mutateAsync();
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="h-full w-full">
        <View className="items-center px-4 py-3">
          <Text className="text-lg font-semibold">Profile</Text>
        </View>

        <ScrollView className="flex-1 px-4">
          {/* Avatar and info */}
          <View className="items-center gap-4 pt-6">
            <View className="bg-default size-24 items-center justify-center overflow-hidden rounded-full">
              {session?.user.image ? (
                <Image
                  source={{ uri: session.user.image }}
                  style={{ width: 96, height: 96 }}
                  contentFit="cover"
                />
              ) : (
                <Ionicons name="person" size={48} color={iconColor} />
              )}
            </View>
            <View className="items-center gap-1">
              <Text className="text-2xl font-bold">
                {session?.user.name ?? "User"}
              </Text>
              {session?.user.email && (
                <Text className="text-sm text-muted">{session.user.email}</Text>
              )}
            </View>
          </View>

          {/* Cards */}
          <View className="mt-8 gap-3 pb-4">
            {/* Discord */}
            <Pressable
              onPress={() => {
                void Linking.openURL("https://discord.gg/DkFmaDDqgW");
              }}
              className="bg-surface rounded-xl p-4 active:opacity-70"
            >
              <View className="flex-row items-center gap-3">
                <View className="bg-default size-10 items-center justify-center rounded-full">
                  <MaterialIcons name="discord" size={20} color={iconColor} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold">
                    Join our Discord
                  </Text>
                  <Text className="text-xs text-muted">
                    Connect with the community
                  </Text>
                </View>
                <Ionicons name="open-outline" size={18} color={iconColor} />
              </View>
            </Pressable>

            {/* Notifications */}
            <View className="bg-surface rounded-xl p-4">
              <View className="flex-row items-center gap-3">
                <View className="bg-default size-10 items-center justify-center rounded-full">
                  <Ionicons name="notifications" size={20} color={iconColor} />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold">Notifications</Text>
                  <Text className="text-xs text-muted">
                    Manage push notifications
                  </Text>
                </View>
              </View>
              <View className="mt-4 gap-4">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm">New whisps</Text>
                  <Switch
                    isSelected={preferences.notifyOnMessages}
                    onSelectedChange={() => handleToggle("notifyOnMessages")}
                  />
                </View>
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm">Friend requests</Text>
                  <Switch
                    isSelected={preferences.notifyOnFriendActivity}
                    onSelectedChange={() =>
                      handleToggle("notifyOnFriendActivity")
                    }
                  />
                </View>
              </View>
            </View>

            {/* About */}
            <View className="bg-surface rounded-xl p-4">
              <View className="flex-row items-center gap-3">
                <View className="bg-default size-10 items-center justify-center rounded-full">
                  <Ionicons
                    name="information-circle"
                    size={20}
                    color={iconColor}
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold">About</Text>
                  <Text className="text-xs text-muted">
                    App information and legal
                  </Text>
                </View>
              </View>
              <View className="mt-4 gap-3">
                <BuildInfo />
                <Pressable
                  onPress={() => {
                    void Linking.openURL("https://whisp.chat/terms");
                  }}
                  className="flex-row items-center justify-between active:opacity-70"
                >
                  <Text className="text-sm">Terms of Service</Text>
                  <Ionicons name="open-outline" size={14} color={iconColor} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    void Linking.openURL("https://whisp.chat/privacy");
                  }}
                  className="flex-row items-center justify-between active:opacity-70"
                >
                  <Text className="text-sm">Privacy Policy</Text>
                  <Ionicons name="open-outline" size={14} color={iconColor} />
                </Pressable>
              </View>
            </View>

            {isBackgroundUploadTestEnabled ? (
              <Pressable
                onPress={() => navigation.navigate("BackgroundUploadTest")}
                className="bg-surface rounded-xl p-4 active:opacity-70"
              >
                <View className="flex-row items-center gap-3">
                  <View className="bg-default size-10 items-center justify-center rounded-full">
                    <Ionicons name="flask" size={20} color={iconColor} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-semibold">
                      Background Upload Test
                    </Text>
                    <Text className="text-xs text-muted">
                      Upload files without sending whisps
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={iconColor}
                  />
                </View>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>

        {/* Bottom actions */}
        <View className="gap-2 px-4 pb-4">
          <Dialog isOpen={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <Dialog.Trigger asChild>
              <Button variant="ghost" className="w-full">
                Delete Account
              </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay />
              <Dialog.Content>
                <Dialog.Title>Delete Account</Dialog.Title>
                <Dialog.Description>
                  Are you sure you want to delete your Whisp account? This will
                  permanently delete all your messages, friend connections, and
                  account data. This action cannot be undone.
                  {"\n\n"}
                  Note: This only deletes your Whisp account. Your Discord
                  account will remain active.
                </Dialog.Description>
                <View className="flex-row justify-end gap-3 pt-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => setDeleteDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onPress={() => {
                      void handleDeleteAccount();
                      setDeleteDialogOpen(false);
                    }}
                  >
                    Delete Account
                  </Button>
                </View>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog>

          <Button
            variant="secondary"
            onPress={async () => {
              console.log("[ProfileScreen] Signing out");
              await authClient.signOut();
            }}
            className="w-full"
          >
            Sign Out
          </Button>
        </View>
      </View>
    </SafeAreaView>
  );
}

function BuildInfo() {
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

  const buildNumber = Constants.expoConfig?.version ?? "1.0.0";
  const nativeBuildVersion =
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode ??
    "1";

  return (
    <>
      <Pressable
        onPress={handleTap}
        className="flex-row items-center justify-between active:opacity-70"
      >
        <Text className="text-sm">Version</Text>
        <Text className="text-sm tabular-nums text-muted">
          {buildNumber} ({nativeBuildVersion})
        </Text>
      </Pressable>

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
