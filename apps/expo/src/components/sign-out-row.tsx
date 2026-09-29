import { useState } from "react";
import { Alert } from "react-native";

import { SettingsGroup, SettingsRow } from "~/components/settings-group";
import { authClient } from "~/utils/auth";

export function SignOutRow() {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut() {
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
  }

  return (
    <SettingsGroup>
      <SettingsRow
        icon="log-out"
        label="Sign out"
        tone="danger"
        disabled={isSigningOut}
        onPress={() => void signOut()}
      />
    </SettingsGroup>
  );
}
