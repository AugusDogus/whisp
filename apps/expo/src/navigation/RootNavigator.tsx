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

const Stack = createNativeStackNavigator();

export function RootNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{ headerShown: false, animation: "none" }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Camera" component={CameraScreen} />
        <Stack.Screen name="Post" component={PostScreen} />
        <Stack.Screen name="Media" component={MediaScreen} />
        <Stack.Screen name="Friends" component={FriendsScreen} />
      </Stack.Navigator>
      <Toaster />
    </NavigationContainer>
  );
}
