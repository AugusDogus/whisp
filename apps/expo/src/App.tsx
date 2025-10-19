import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";
import { PostHogProvider } from "posthog-react-native";

import { usePushNotifications } from "~/hooks/usePushNotifications";
import { createExpoTRPCClient, queryClient, trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { POSTHOG_API_KEY, POSTHOG_HOST } from "~/utils/constants";
import { RootNavigator } from "./navigation/RootNavigator";

import "./styles.css";

function AppContent() {
  const { data: session } = authClient.useSession();

  // Request notification permissions immediately (before auth)
  // but only register token after authentication
  usePushNotifications(session?.user != null);

  return (
    <BottomSheetModalProvider>
      <View style={{ flex: 1 }}>
        <RootNavigator />
        <StatusBar />
        <PortalHost />
      </View>
    </BottomSheetModalProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <PostHogProvider
          apiKey={POSTHOG_API_KEY}
          options={{
            host: POSTHOG_HOST,
            enableSessionReplay: false,
          }}
          autocapture={{
            captureScreens: false,
            captureTouches: true,
          }}
        >
          <QueryClientProvider client={queryClient}>
            <trpc.Provider
              client={createExpoTRPCClient()}
              queryClient={queryClient}
            >
              <AppContent />
            </trpc.Provider>
          </QueryClientProvider>
        </PostHogProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
