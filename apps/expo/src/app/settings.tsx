import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { Linking } from "react-native";

import { useNavigation } from "@react-navigation/native";

import { AccountSettings } from "~/components/account-settings";
import { BuildInfo } from "~/components/build-info";
import { NotificationSettings } from "~/components/notification-settings";
import { SendToMyselfRow } from "~/components/preview-settings";
import { SettingsGroup, SettingsRow } from "~/components/settings-group";
import { SettingsPage } from "~/components/settings-page";
import { TermsAcceptance } from "~/components/terms-acceptance";
import { isPreviewApp } from "~/hooks/usePreviewSettings";
import type { RootStackParamList } from "~/navigation/types";

const isBackgroundUploadTestEnabled =
  process.env.EXPO_PUBLIC_ENABLE_BACKGROUND_UPLOAD_TEST_PAGE === "true";

export default function SettingsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <SettingsPage title="Settings">
      <NotificationSettings />

      <SettingsGroup title="Privacy & security">
        <SettingsRow
          label="Blocked accounts"
          end={{ kind: "navigate" }}
          onPress={() => navigation.navigate("BlockedAccounts")}
        />
        <SettingsRow
          label="Devices"
          end={{ kind: "navigate" }}
          onPress={() => navigation.navigate("Devices")}
        />
        <SettingsRow
          label="Encryption recovery"
          end={{ kind: "navigate" }}
          onPress={() => navigation.navigate("EncryptionRecovery")}
        />
      </SettingsGroup>

      <SettingsGroup title="Developer">
        {isPreviewApp && <SendToMyselfRow />}
        {__DEV__ && (
          <SettingsRow
            label="MLS bridge test"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("MlsTest")}
          />
        )}
        {isBackgroundUploadTestEnabled && (
          <SettingsRow
            label="Background upload test"
            end={{ kind: "navigate" }}
            onPress={() => navigation.navigate("BackgroundUploadTest")}
          />
        )}
      </SettingsGroup>

      <SettingsGroup title="About">
        <BuildInfo />
        <SettingsRow
          label="Terms of Service"
          end={{ kind: "external" }}
          onPress={() => void Linking.openURL("https://whisp.chat/terms")}
        />
        <SettingsRow
          label="Privacy Policy"
          end={{ kind: "external" }}
          onPress={() => void Linking.openURL("https://whisp.chat/privacy")}
        />
      </SettingsGroup>
      <TermsAcceptance />

      <AccountSettings />
    </SettingsPage>
  );
}
