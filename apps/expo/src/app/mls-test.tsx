import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import type { MlsSmokeTestResult } from "react-native-whisp-mls";

import { useNavigation } from "@react-navigation/native";
import { Button } from "heroui-native/button";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | MlsSmokeTestResult;

export default function MlsTestScreen() {
  const navigation = useNavigation();
  const [state, setState] = useState<TestState>({ status: "idle" });
  const running = useRef(false);

  async function runTest() {
    if (!__DEV__ || running.current) return;
    running.current = true;
    setState({ status: "running" });
    try {
      // Load only on demand so an older dev client can still open the app.
      const { runMlsSmokeTest } = await import("react-native-whisp-mls");
      setState(runMlsSmokeTest());
    } catch (error: unknown) {
      setState({
        status: "failed",
        message:
          error instanceof Error
            ? error.message
            : "Could not load the MLS module. Build it and rebuild the Expo dev client.",
      });
    } finally {
      running.current = false;
    }
  }

  if (!__DEV__) return null;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Button variant="secondary" onPress={() => navigation.goBack()}>
          Back
        </Button>
        <Text className="text-xl font-semibold">MLS bridge test</Text>
        <Text className="text-muted">
          Test encrypted messages between three temporary clients on this
          device. This diagnostic sends nothing over the network.
        </Text>
        <Button
          isDisabled={state.status === "running"}
          onPress={() => void runTest()}
        >
          {state.status === "running" ? "Testing…" : "Run test"}
        </Button>
        <View accessibilityLiveRegion="polite" className="gap-2">
          {state.status === "passed" ? (
            <>
              <Text className="font-semibold">All checks passed</Text>
              {state.checks.map((check) => (
                <Text key={check}>{check}</Text>
              ))}
            </>
          ) : state.status === "failed" ? (
            <Text selectable>{state.message}</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
