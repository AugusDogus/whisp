import { Linking, View } from "react-native";

import { Text } from "~/components/ui/text";

export function TermsLinks() {
  return (
    <View className="flex-row flex-wrap justify-center gap-x-4">
      <Text
        accessibilityRole="link"
        className="py-3 text-sm text-muted underline"
        onPress={() => void Linking.openURL("https://whisp.chat/terms")}
      >
        Terms of Service
      </Text>
      <Text
        accessibilityRole="link"
        className="py-3 text-sm text-muted underline"
        onPress={() => void Linking.openURL("https://whisp.chat/privacy")}
      >
        Privacy Policy
      </Text>
    </View>
  );
}
