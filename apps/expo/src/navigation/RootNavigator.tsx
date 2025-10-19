import type {
  LinkingOptions,
  NavigationContainerRef,
} from "@react-navigation/native";
import { createRef, useRef } from "react";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { usePostHog } from "posthog-react-native";
import { Toaster } from "sonner-native";

import type { RootStackParamList } from "./types";
import CameraScreen from "~/app/camera";
import FriendsScreen from "~/app/friends";
import SplashScreen from "~/app/index";
import LoginScreen from "~/app/login";
import MediaScreen from "~/app/media";
import OnboardingScreen from "~/app/onboarding";
import PostScreen from "~/app/post/[id]";
import ProfileScreen from "~/app/profile";
import { RecordingProvider, useRecording } from "~/contexts/RecordingContext";

const Stack = createNativeStackNavigator<RootStackParamList>();
const TopTabs = createMaterialTopTabNavigator();

// Export navigation ref for use outside React components (e.g., push notifications)
export const navigationRef =
  createRef<NavigationContainerRef<RootStackParamList>>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["whisp://", "exp+whisp://"],
  config: {
    screens: {
      Splash: "splash",
      Login: "login",
      Onboarding: "onboarding",
      Main: "main",
      Post: "post/:id",
      Media: "media",
    },
  },
};

function MainTabs() {
  const { isRecording, isSendMode } = useRecording();

  return (
    <TopTabs.Navigator
      initialRouteName="Camera"
      tabBarPosition="bottom"
      backBehavior="initialRoute" // Always go back to Camera (initial route)
      screenOptions={{
        tabBarStyle: { display: "none" },
        swipeEnabled: !isRecording && !isSendMode, // Disable swipe when recording or in send mode
      }}
    >
      <TopTabs.Screen name="Friends" component={FriendsScreen} />
      <TopTabs.Screen name="Camera" component={CameraScreen} />
      <TopTabs.Screen name="Profile" component={ProfileScreen} />
    </TopTabs.Navigator>
  );
}

export function RootNavigator() {
  const routeNameRef = useRef<string | undefined>(undefined);
  const posthog = usePostHog();

  return (
    <RecordingProvider>
      <NavigationContainer
        linking={linking}
        ref={navigationRef}
        onReady={() => {
          routeNameRef.current = navigationRef.current?.getCurrentRoute()?.name;
        }}
        onStateChange={() => {
          const previousRouteName = routeNameRef.current;
          const currentRouteName =
            navigationRef.current?.getCurrentRoute()?.name;

          if (previousRouteName !== currentRouteName && currentRouteName) {
            void posthog.screen(currentRouteName);
          }

          routeNameRef.current = currentRouteName;
        }}
      >
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{ headerShown: false, animation: "none" }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Post" component={PostScreen} />
          <Stack.Screen name="Media" component={MediaScreen} />
        </Stack.Navigator>
        <Toaster />
      </NavigationContainer>
    </RecordingProvider>
  );
}
