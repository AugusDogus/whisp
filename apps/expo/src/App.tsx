import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalHost } from "@rn-primitives/portal";
import * as Sentry from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { PostHogProvider } from "posthog-react-native";

import { usePushNotifications } from "~/hooks/usePushNotifications";
import { createExpoTRPCClient, queryClient, trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { POSTHOG_API_KEY, POSTHOG_HOST } from "~/utils/constants";
import { RootNavigator } from "./navigation/RootNavigator";

import "./styles.css";

Sentry.init({
  dsn: "https://5693f19ead65be751194632cbd5fa070@o4510218619322368.ingest.us.sentry.io/4510898735874048",

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,
  integrations: [Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

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

export default Sentry.wrap(function App() {
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
});
