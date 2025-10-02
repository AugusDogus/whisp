import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from "react-native-safe-area-context";
import { Redirect, Stack, useSegments } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { PortalHost } from "@rn-primitives/portal";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "~/utils/api";

import "../styles.css";

// Keep the splash screen visible while we check for stored session
void SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const segments = useSegments();
  const [hasStoredSession, setHasStoredSession] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    // Quickly check if we have a session token in secure storage
    async function checkStoredSession() {
      try {
        // Check for better-auth cookie (storagePrefix + "_cookie")
        const cookie = await SecureStore.getItemAsync("whisp_cookie");
        setHasStoredSession(!!cookie);
      } catch {
        setHasStoredSession(false);
      } finally {
        // Hide splash screen once we've checked storage
        void SplashScreen.hideAsync();
      }
    }

    void checkStoredSession();
  }, []);

  // Don't render navigation until we've checked for stored session
  if (hasStoredSession === null) {
    return null;
  }

  // Redirect based on stored session
  const currentRoute = segments[0] as string | undefined;

  if (hasStoredSession && currentRoute === undefined) {
    // User has a stored session and is on index page, redirect to camera
    return <Redirect href="/camera" />;
  }

  if (!hasStoredSession && currentRoute === "camera") {
    // User has no stored session but trying to access camera, redirect to index
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    />
  );
}

// This is the main layout of the app
// It wraps your pages with the providers they need
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <QueryClientProvider client={queryClient}>
          <RootLayoutNav />
          <StatusBar />
          <PortalHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
