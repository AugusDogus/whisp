import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";

import { createExpoTRPCClient, queryClient, trpc } from "~/utils/api";
import { RootNavigator } from "./navigation/RootNavigator";

import "./styles.css";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <trpc.Provider
            client={createExpoTRPCClient()}
            queryClient={queryClient}
          >
            <View style={{ flex: 1 }}>
              <RootNavigator />
              <StatusBar />
              <PortalHost />
            </View>
          </trpc.Provider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
