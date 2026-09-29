import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useRef, useState } from "react";
import { Linking, ScrollView, View } from "react-native";

import { useIsFocused, useNavigation } from "@react-navigation/native";

import { DiscordProfileCard } from "~/components/discord-profile-card";
import { SettingsGroup, SettingsRow } from "~/components/settings-group";
import { SafeAreaView } from "~/components/styled";
import type { RootStackParamList } from "~/navigation/types";
import { authClient } from "~/utils/auth";

export default function ProfileScreen() {
  const isFocused = useIsFocused();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [profileVisible, setProfileVisible] = useState(true);
  const profileHeight = useRef(0);
  const { data: session } = authClient.useSession();

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-4 pt-2 pb-6"
        scrollEventThrottle={100}
        onScroll={({ nativeEvent }) => {
          setProfileVisible(
            nativeEvent.contentOffset.y < profileHeight.current,
          );
        }}
      >
        <View
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
        </View>

        <SettingsGroup>
          <SettingsRow
            label="Settings"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("Settings")}
          />
          <SettingsRow
            label="Join our Discord"
            end={{ kind: "external" }}
            onPress={() =>
              void Linking.openURL("https://discord.gg/DkFmaDDqgW")
            }
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
