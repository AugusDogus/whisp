import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import type { RootStackParamList } from "~/navigation/types";

export default function Post() {
  const route = useRoute<RouteProp<RootStackParamList, "Post">>();
  const { id } = route.params;
  const { data } = useQuery(trpc.post.byId.queryOptions({ id }));

  if (!data) return null;

  return (
    <SafeAreaView className="bg-background">
      <View className="h-full w-full p-4">
        <Card>
          <CardHeader>
            <CardTitle>{data.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <Text variant="p">{data.content}</Text>
          </CardContent>
        </Card>
      </View>
    </SafeAreaView>
  );
}
