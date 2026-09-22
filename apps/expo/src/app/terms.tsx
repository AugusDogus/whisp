import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useCallback } from "react";

import { useNavigation, useRoute } from "@react-navigation/native";

import { ContentPolicyScreen } from "~/components/content-policy-screen";
import type { RootStackParamList } from "~/navigation/types";

export default function TermsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, "Terms">>();
  const onContinue = useCallback(() => {
    if (params.source === "profile") navigation.goBack();
    else navigation.replace("Main");
  }, [navigation, params.source]);
  return (
    <ContentPolicyScreen
      mode={params.source === "profile" ? "review" : "onboarding"}
      onContinue={onContinue}
    />
  );
}
