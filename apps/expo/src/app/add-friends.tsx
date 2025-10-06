import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { AddFriendsPanel } from "~/components/add-friends-panel";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

export default function AddFriendsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <SafeAreaView className="bg-background">
      <View className="h-full w-full">
        <View className="flex-row items-center justify-between px-4 py-3">
          <Button variant="secondary" onPress={() => navigation.goBack()}>
            <Text>Back</Text>
          </Button>
          <Text className="text-lg font-semibold">Add friends</Text>
          <View style={{ width: 80 }} />
        </View>
        <View className="flex-1 px-4 pb-4">
          <AddFriendsPanel />
        </View>
      </View>
    </SafeAreaView>
  );
}
