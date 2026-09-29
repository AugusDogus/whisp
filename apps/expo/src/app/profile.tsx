import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { ComponentProps, ReactNode } from "react";
import { Children, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  useColorScheme,
  View,
} from "react-native";

import Constants from "expo-constants";

import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { Switch } from "heroui-native/switch";

import { DiscordProfileCard } from "~/components/discord-profile-card";
import { PreviewSettings } from "~/components/preview-settings";
import { SafeAreaView } from "~/components/styled";
import { TermsAcceptance } from "~/components/terms-acceptance";
import { Text } from "~/components/ui/text";
import type { RootStackParamList } from "~/navigation/types";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";

export default function ProfileScreen() {
  const isFocused = useIsFocused();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [profileVisible, setProfileVisible] = useState(true);
  const profileHeight = useRef(0);
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

  const deleteAccount = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => {
      setDeleteDialogOpen(false);
      await authClient.signOut();
    },
  });

  const handleToggle = (key: keyof typeof preferences) => {
    updatePreferences.mutate({
      [key]: !preferences[key],
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1 px-4"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent }) => {
          setProfileVisible(
            nativeEvent.contentOffset.y < profileHeight.current,
          );
        }}
      >
        {/* Avatar and info */}
        <View
          className="gap-3 pt-2"
          onLayout={({ nativeEvent }) => {
            profileHeight.current = nativeEvent.layout.height;
          }}
        >
          {session?.user && (
            <DiscordProfileCard
              key={session.user.id}
              userId={session.user.id}
              name={session.user.name}
              image={session.user.image ?? null}
              active={isFocused && profileVisible}
            />
          )}
          {session?.user.email && (
            <Text className="text-center text-sm text-muted">
              {session.user.email}
            </Text>
          )}
        </View>

        <View className="mt-6 gap-4 pb-6">
          <Group>
            <LinkRow
              accessibilityRole="button"
              icon={
                <Ionicons name="settings-outline" size={20} color={iconColor} />
              }
              label="Settings"
              trailing="chevron-forward"
              iconColor={iconColor}
              onPress={() => navigation.navigate("Settings")}
            />
            <LinkRow
              ph-no-capture
              accessibilityRole="button"
              icon={<Ionicons name="ban" size={20} color={iconColor} />}
              label="Blocked accounts"
              trailing="chevron-forward"
              iconColor={iconColor}
              onPress={() => navigation.navigate("BlockedAccounts")}
            />
            <LinkRow
              accessibilityRole="link"
              icon={
                <MaterialIcons name="discord" size={20} color={iconColor} />
              }
              label="Join our Discord"
              trailing="open-outline"
              iconColor={iconColor}
              onPress={() => {
                void Linking.openURL("https://discord.gg/DkFmaDDqgW");
              }}
            />
          </Group>

          <Group title="Notifications">
            <View className="flex-row items-center justify-between px-4 py-3">
              <Text className="text-sm">New whisps</Text>
              <Switch
                isSelected={preferences.notifyOnMessages}
                onSelectedChange={() => handleToggle("notifyOnMessages")}
              />
            </View>
            <View className="flex-row items-center justify-between px-4 py-3">
              <Text className="text-sm">Friend requests</Text>
              <Switch
                isSelected={preferences.notifyOnFriendActivity}
                onSelectedChange={() => handleToggle("notifyOnFriendActivity")}
              />
            </View>
          </Group>

          <PreviewSettings />

          <Group title="About">
            <BuildInfo />
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL("https://whisp.chat/terms");
              }}
              className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
            >
              <Text className="text-sm">Terms of Service</Text>
              <Ionicons name="open-outline" size={14} color={iconColor} />
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL("https://whisp.chat/privacy");
              }}
              className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
            >
              <Text className="text-sm">Privacy Policy</Text>
              <Ionicons name="open-outline" size={14} color={iconColor} />
            </Pressable>
          </Group>
          <TermsAcceptance />

          {__DEV__ ? (
            <Button
              variant="secondary"
              onPress={() => navigation.navigate("MlsTest")}
            >
              MLS bridge test
            </Button>
          ) : null}

          {isBackgroundUploadTestEnabled ? (
            <Group>
              <LinkRow
                accessibilityRole="button"
                icon={<Ionicons name="flask" size={20} color={iconColor} />}
                label="Background Upload Test"
                trailing="chevron-forward"
                iconColor={iconColor}
                onPress={() => navigation.navigate("BackgroundUploadTest")}
              />
            </Group>
          ) : null}

          <View className="gap-2">
            <Dialog
              isOpen={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
            >
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
                    Are you sure you want to delete your whisp account? This
                    will remove your account, messages, groups you created,
                    friendships, and reports involving you. Cloud files are
                    queued for deletion. This action cannot be undone.
                    {"\n\n"}A confirmed serious-abuse decision may retain a
                    protected account identifier until its suspension expires.
                    Contact augie@luebbers.email to appeal or object to
                    retention.
                    {"\n\n"}
                    Note: This only deletes your whisp account. Your Discord
                    account will remain active.
                  </Dialog.Description>
                  {deleteAccount.error && (
                    <Text accessibilityRole="alert" className="text-danger">
                      Account deletion could not be confirmed. Try again. If you
                      are signed out, contact augie@luebbers.email for help.
                    </Text>
                  )}
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
                      isDisabled={deleteAccount.isPending}
                      onPress={() => deleteAccount.mutate()}
                    >
                      Delete Account
                    </Button>
                  </View>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog>

            <Button
              variant="secondary"
              isDisabled={isSigningOut}
              onPress={async () => {
                setIsSigningOut(true);
                try {
                  const result = await authClient.signOut();
                  if (result.error) {
                    Alert.alert(
                      "Could not sign out",
                      "Please check your connection and try again.",
                    );
                  }
                } catch (error) {
                  console.error("Sign-out failed:", error);
                  Alert.alert(
                    "Could not sign out",
                    "Please check your connection and try again.",
                  );
                } finally {
                  setIsSigningOut(false);
                }
              }}
              className="w-full"
            >
              Sign Out
            </Button>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Rounded card whose children are single rows separated by hairlines. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
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

function LinkRow({
  icon,
  label,
  trailing,
  iconColor,
  ...props
}: ComponentProps<typeof Pressable> & {
  icon: ReactNode;
  label: string;
  trailing: "chevron-forward" | "open-outline";
  iconColor: string;
}) {
  return (
    <Pressable
      {...props}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
    >
      {icon}
      <Text className="flex-1 text-base">{label}</Text>
      <Ionicons name={trailing} size={16} color={iconColor} />
    </Pressable>
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
        className="flex-row items-center justify-between px-4 py-3 active:opacity-70"
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
