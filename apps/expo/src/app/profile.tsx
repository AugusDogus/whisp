import { useRef, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";

export default function ProfileScreen() {
  const { data: session } = authClient.useSession();
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
    <SafeAreaView className="bg-background">
      <View className="h-full w-full">
        <View className="items-center px-4 py-3 pb-4">
          <Text className="text-lg font-semibold">Profile</Text>
        </View>

        <ScrollView className="flex-1 px-4">
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
          <View className="mt-8 gap-3 pb-4">
            {/* Discord Card */}
            <Pressable
              onPress={() => {
                void Linking.openURL("https://discord.gg/DkFmaDDqgW");
              }}
              className="rounded-lg border border-border bg-background p-4 shadow-sm shadow-black/5 active:opacity-70"
            >
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <MaterialIcons name="discord" size={20} color="#666" />
                </View>
                <View className="flex-1">
                  <Text className="text-base font-semibold">
                    Join our Discord
                  </Text>
                  <Text variant="muted" className="text-xs">
                    Connect with the community
                  </Text>
                </View>
                <Ionicons name="open-outline" size={20} color="#666" />
              </View>
            </Pressable>

            {/* Notifications Card */}
            <View className="rounded-lg border border-border bg-background p-4 shadow-sm shadow-black/5">
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
            <View className="rounded-lg border border-border bg-background p-4 shadow-sm shadow-black/5">
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
                <BuildInfo />
                <Pressable
                  onPress={() => {
                    void Linking.openURL("https://whisp.chat/terms");
                  }}
                  className="active:opacity-70"
                >
                  <Text className="text-sm text-primary">Terms of Service</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void Linking.openURL("https://whisp.chat/privacy");
                  }}
                  className="active:opacity-70"
                >
                  <Text className="text-sm text-primary">Privacy Policy</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Bottom section - Delete Account & Sign out */}
        <View className="gap-3 px-4 pb-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" className="w-full">
                <Text>Delete Account</Text>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Account</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete your Whisp account? This will
                  permanently delete all your messages, friend connections, and
                  account data. This action cannot be undone.
                  {"\n\n"}
                  Note: This only deletes your Whisp account. Your Discord
                  account will remain active.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Text>Cancel</Text>
                </AlertDialogCancel>
                <AlertDialogAction onPress={handleDeleteAccount}>
                  <Text>Delete Account</Text>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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
      </View>
    </SafeAreaView>
  );
}

function BuildInfo() {
  const tapCount = useRef(0);
  const tapTimeout = useRef<NodeJS.Timeout | undefined>(undefined);
  const [showDialog, setShowDialog] = useState(false);

  function handleTap() {
    // Clear existing timeout
    if (tapTimeout.current) {
      clearTimeout(tapTimeout.current);
    }

    // Increment tap count
    tapCount.current += 1;

    // If we hit 3 taps, show env vars
    if (tapCount.current === 3) {
      setShowDialog(true);
      tapCount.current = 0;
    } else {
      // Reset tap count after 500ms
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
    };

    const envVars = Object.entries(process.env)
      .filter(([key]) => key.startsWith("EXPO_PUBLIC_"))
      .map(([key, value]) => ({
        key: envVarMap[key] ?? key,
        value: (value as string | undefined) ?? "undefined",
      }));

    // Add computed API Server at the end
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
        <Text variant="muted" className="text-sm">
          {buildNumber} ({nativeBuildVersion})
        </Text>
      </Pressable>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Environment</DialogTitle>
            <DialogDescription>
              Current environment configuration
            </DialogDescription>
          </DialogHeader>
          <ScrollView className="max-h-96">
            <View className="overflow-hidden rounded-lg border border-border">
              {getEnvVars().map((item, index) => (
                <View
                  key={item.key}
                  className={`p-3 ${
                    index % 2 === 0 ? "bg-secondary/50" : "bg-background"
                  }`}
                >
                  <Text className="text-xs font-semibold text-foreground">
                    {item.key}
                  </Text>
                  <Text className="mt-1 text-xs text-muted-foreground">
                    {item.value}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
          <DialogFooter>
            <DialogClose asChild>
              <Button>
                <Text>Close</Text>
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
