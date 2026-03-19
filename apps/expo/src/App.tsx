import { useEffect } from "react";
import { AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";

import { StatusBar } from "expo-status-bar";

import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import * as Sentry from "@sentry/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { HeroUINativeProvider } from "heroui-native/provider";
import { PostHogProvider } from "posthog-react-native";

import { usePushNotifications } from "~/hooks/usePushNotifications";
import { createExpoTRPCClient, queryClient, trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { POSTHOG_API_KEY, POSTHOG_HOST } from "~/utils/constants";
import {
  listBackgroundUploadTasks,
  markBackgroundUploadTaskObserved,
  removeBackgroundUploadTask,
} from "~/utils/uploadthing";

import { RootNavigator } from "./navigation/RootNavigator";
import "./styles.css";

async function removeBackgroundUploadTasks(taskIds: string[]) {
  const uniqueTaskIds = [...new Set(taskIds)];
  await Promise.allSettled(
    uniqueTaskIds.map((taskId) => removeBackgroundUploadTask(taskId)),
  );
}

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

  useEffect(() => {
    async function reconcileBackgroundUploads() {
      try {
        const tasks = await listBackgroundUploadTasks();
        const terminalTasks = tasks.filter(
          (task) =>
            task.status === "completed" ||
            task.status === "failed" ||
            task.status === "cancelled",
        );

        if (terminalTasks.length === 0) {
          return;
        }

        const unobservedTerminalTasks = terminalTasks.filter(
          (task) => task.observedAt == null,
        );
        await Promise.allSettled(
          unobservedTerminalTasks.map((task) =>
            markBackgroundUploadTaskObserved(task.taskId),
          ),
        );

        const observedTerminalTasks = terminalTasks.filter(
          (task) => task.observedAt != null,
        );

        if (observedTerminalTasks.length > 0) {
          await removeBackgroundUploadTasks(
            observedTerminalTasks.map((task) => task.taskId),
          );
        }

        void queryClient.invalidateQueries({
          queryKey: [["friends", "list"]] as const,
        });
        void queryClient.invalidateQueries({
          queryKey: [["messages", "inbox"]] as const,
        });
        void queryClient.invalidateQueries({
          queryKey: [["groups", "list"]] as const,
        });
        void queryClient.invalidateQueries({
          predicate: (query) => {
            const key = query.queryKey as [string[], ...unknown[]];
            return (
              Array.isArray(key[0]) &&
              key[0][0] === "groups" &&
              key[0][1] === "inbox"
            );
          },
        });
      } catch (error) {
        console.warn(
          "[Upload] Failed to reconcile background upload tasks:",
          error,
        );
      }
    }

    void reconcileBackgroundUploads();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void reconcileBackgroundUploads();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <BottomSheetModalProvider>
      <View className="flex-1">
        <RootNavigator />
        <StatusBar />
      </View>
    </BottomSheetModalProvider>
  );
}

export default Sentry.wrap(function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider>
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
      </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
});
