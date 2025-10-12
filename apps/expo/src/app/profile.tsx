import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { authClient } from "~/utils/auth";

export default function ProfileScreen() {
  const { data: session } = authClient.useSession();

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

          {/* Stats or additional info section */}
          <View className="mt-8 gap-3">
            <View className="rounded-lg bg-secondary p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Ionicons name="people" size={20} color="#666" />
                </View>
                <View>
                  <Text className="text-base font-semibold">Friends</Text>
                  <Text variant="muted" className="text-xs">
                    Manage your connections
                  </Text>
                </View>
              </View>
            </View>

            <View className="rounded-lg bg-secondary p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Ionicons name="settings" size={20} color="#666" />
                </View>
                <View>
                  <Text className="text-base font-semibold">Settings</Text>
                  <Text variant="muted" className="text-xs">
                    Customize your experience
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Bottom section - Sign out */}
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
        </View>
      </View>
    </SafeAreaView>
  );
}
