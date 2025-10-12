import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Toaster } from "sonner-native";

// import type { RootStackParamList } from "./types";
import CameraScreen from "~/app/camera";
import FriendsScreen from "~/app/friends";
import SplashScreen from "~/app/index";
import LoginScreen from "~/app/login";
import MediaScreen from "~/app/media";
import PostScreen from "~/app/post/[id]";
import ProfileScreen from "~/app/profile";
import { RecordingProvider, useRecording } from "~/contexts/RecordingContext";

const Stack = createNativeStackNavigator();
const TopTabs = createMaterialTopTabNavigator();

function MainTabs() {
  const { isRecording } = useRecording();

  return (
    <TopTabs.Navigator
      initialRouteName="Camera"
      tabBarPosition="bottom"
      screenOptions={{
        tabBarStyle: { display: "none" },
        swipeEnabled: !isRecording, // Disable swipe when recording
      }}
    >
      <TopTabs.Screen name="Friends" component={FriendsScreen} />
      <TopTabs.Screen name="Camera" component={CameraScreen} />
      <TopTabs.Screen name="Profile" component={ProfileScreen} />
    </TopTabs.Navigator>
  );
}

export function RootNavigator() {
  return (
    <RecordingProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Splash"
          screenOptions={{ headerShown: false, animation: "none" }}
        >
          <Stack.Screen name="Splash" component={SplashScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Post" component={PostScreen} />
          <Stack.Screen name="Media" component={MediaScreen} />
        </Stack.Navigator>
        <Toaster />
      </NavigationContainer>
    </RecordingProvider>
  );
}
