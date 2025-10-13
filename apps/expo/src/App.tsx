import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";

import { usePushNotifications } from "~/hooks/usePushNotifications";
import { createExpoTRPCClient, queryClient, trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { RootNavigator } from "./navigation/RootNavigator";

import "./styles.css";

function AppContent() {
  const { data: session } = authClient.useSession();

  // Request notification permissions immediately (before auth)
  // but only register token after authentication
  usePushNotifications(session?.user != null);

  return (
    <View style={{ flex: 1 }}>
      <RootNavigator />
      <StatusBar />
      <PortalHost />
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <trpc.Provider
            client={createExpoTRPCClient()}
            queryClient={queryClient}
          >
            <AppContent />
          </trpc.Provider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
