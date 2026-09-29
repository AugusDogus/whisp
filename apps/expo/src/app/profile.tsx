import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useRef, useState } from "react";
import { Linking, ScrollView, View } from "react-native";

import { useIsFocused, useNavigation } from "@react-navigation/native";

import { BuildInfo } from "~/components/build-info";
import { DiscordProfileCard } from "~/components/discord-profile-card";
import { SendToMyselfRow } from "~/components/preview-settings";
import { SettingsGroup, SettingsRow } from "~/components/settings-group";
import { SignOutRow } from "~/components/sign-out-row";
import { SafeAreaView } from "~/components/styled";
import { TermsAcceptance } from "~/components/terms-acceptance";
import { isPreviewApp } from "~/hooks/usePreviewSettings";
import type { RootStackParamList } from "~/navigation/types";
import { authClient } from "~/utils/auth";

const isBackgroundUploadTestEnabled =
  process.env.EXPO_PUBLIC_ENABLE_BACKGROUND_UPLOAD_TEST_PAGE === "true";

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

        <TermsAcceptance />

        <SettingsGroup title="Account settings">
          <SettingsRow
            icon="person-circle"
            label="Account"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("Account")}
          />
          <SettingsRow
            icon="ban"
            label="Blocked accounts"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("BlockedAccounts")}
          />
          <SettingsRow
            icon="phone-portrait"
            label="Devices"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("Devices")}
          />
          <SettingsRow
            icon="key"
            label="Encryption recovery"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("EncryptionRecovery")}
          />
        </SettingsGroup>

        <SettingsGroup title="App settings">
          <SettingsRow
            icon="notifications"
            label="Notifications"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("Notifications")}
          />
        </SettingsGroup>

        <SettingsGroup title="Support">
          <SettingsRow
            icon="logo-discord"
            label="Join our Discord"
            end={{ kind: "external" }}
            onPress={() =>
              void Linking.openURL("https://discord.gg/DkFmaDDqgW")
            }
          />
          <SettingsRow
            icon="document-text"
            label="Terms of Service"
            end={{ kind: "external" }}
            onPress={() => void Linking.openURL("https://whisp.chat/terms")}
          />
          <SettingsRow
            icon="shield-checkmark"
            label="Privacy Policy"
            end={{ kind: "external" }}
            onPress={() => void Linking.openURL("https://whisp.chat/privacy")}
          />
        </SettingsGroup>

        <SignOutRow />

        <SettingsGroup title="Developer settings">
          <BuildInfo />
          {isPreviewApp && <SendToMyselfRow />}
          {__DEV__ && (
            <SettingsRow
              icon="flask"
              label="MLS bridge test"
              end={{ kind: "navigate" }}
              onPress={() => navigation.navigate("MlsTest")}
            />
          )}
          {isBackgroundUploadTestEnabled && (
            <SettingsRow
              icon="cloud-upload"
              label="Background upload test"
              end={{ kind: "navigate" }}
              onPress={() => navigation.navigate("BackgroundUploadTest")}
            />
          )}
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}
