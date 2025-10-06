import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Toaster } from "sonner-native";

// import type { RootStackParamList } from "./types";
import AddFriendsScreen from "~/app/add-friends";
import CameraScreen from "~/app/camera";
import FriendsScreen from "~/app/friends";
import InboxScreen from "~/app/inbox";
import SplashScreen from "~/app/index";
import LoginScreen from "~/app/login";
import MediaScreen from "~/app/media";
import PostScreen from "~/app/post/[id]";

const Stack = createNativeStackNavigator();
const TopTabs = createMaterialTopTabNavigator();

function MainTabs() {
  return (
    <TopTabs.Navigator
      initialRouteName="Camera"
      tabBarPosition="bottom"
      screenOptions={{ tabBarStyle: { display: "none" }, swipeEnabled: true }}
    >
      <TopTabs.Screen name="Inbox" component={InboxScreen} />
      <TopTabs.Screen name="Camera" component={CameraScreen} />
    </TopTabs.Navigator>
  );
}

export function RootNavigator() {
  return (
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
        <Stack.Screen name="Friends" component={FriendsScreen} />
        <Stack.Screen name="AddFriends" component={AddFriendsScreen} />
      </Stack.Navigator>
      <Toaster />
    </NavigationContainer>
  );
}
