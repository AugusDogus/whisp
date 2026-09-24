import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useCallback } from "react";

import { useNavigation } from "@react-navigation/native";

import { ContentPolicyScreen } from "~/components/content-policy-screen";
import type { RootStackParamList } from "~/navigation/types";

export default function TermsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onContinue = useCallback(
    () => navigation.replace("Main"),
    [navigation],
  );
  return <ContentPolicyScreen onContinue={onContinue} />;
}
