import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LegendList } from "@legendapp/list";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { RootStackParamList } from "~/navigation/types";
import type { RouterOutputs } from "~/utils/api";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";

function PostCard(props: {
  post: RouterOutputs["post"]["all"][number];
  onDelete: () => void;
}) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Card>
      <Pressable
        onPress={() => navigation.navigate("Post", { id: props.post.id })}
      >
        <CardHeader>
          <CardTitle>{props.post.title}</CardTitle>
          <CardDescription className="mt-2">
            {props.post.content}
          </CardDescription>
        </CardHeader>
      </Pressable>
      <CardFooter>
        <Button variant="destructive" size="sm" onPress={props.onDelete}>
          <Text>Delete</Text>
        </Button>
      </CardFooter>
    </Card>
  );
}

function CreatePost() {
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const { mutate, error } = useMutation(
    trpc.post.create.mutationOptions({
      async onSuccess() {
        setTitle("");
        setContent("");
        await queryClient.invalidateQueries(trpc.post.all.queryFilter());
      },
    }),
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Create Post</CardTitle>
        <CardDescription>Share your thoughts with the world</CardDescription>
      </CardHeader>
      <CardContent className="gap-4">
        <View className="gap-2">
          <Input
            value={title}
            onChangeText={setTitle}
            placeholder="Title"
            aria-label="Post title"
          />
          {error?.data?.zodError?.fieldErrors.title && (
            <Text className="text-sm text-destructive">
              {error.data.zodError.fieldErrors.title}
            </Text>
          )}
        </View>
        <View className="gap-2">
          <Input
            value={content}
            onChangeText={setContent}
            placeholder="Content"
            multiline
            numberOfLines={4}
            aria-label="Post content"
          />
          {error?.data?.zodError?.fieldErrors.content && (
            <Text className="text-sm text-destructive">
              {error.data.zodError.fieldErrors.content}
            </Text>
          )}
        </View>
        {error?.data?.code === "UNAUTHORIZED" && (
          <Text className="text-sm text-destructive">
            You need to be logged in to create a post
          </Text>
        )}
      </CardContent>
      <CardFooter>
        <Button
          onPress={() => {
            mutate({
              title,
              content,
            });
          }}
        >
          <Text>Create Post</Text>
        </Button>
      </CardFooter>
    </Card>
  );
}

function MobileAuth() {
  const { data: session } = authClient.useSession();
  const [isSigningIn, setIsSigningIn] = useState(false);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-center">
            {session?.user.name
              ? `Hello, ${session.user.name}`
              : "Not logged in"}
          </CardTitle>
        </CardHeader>
        <CardFooter className="justify-center">
          <Button
            variant="secondary"
            disabled={isSigningIn}
            onPress={async () => {
              setIsSigningIn(true);
              await authClient.signIn.social({
                provider: "discord",
                callbackURL: "/camera",
              });
              // Don't set to false - navigating away or will be set by useEffect
            }}
          >
            <Text>Sign In With Discord</Text>
          </Button>
        </CardFooter>
      </Card>

      {/* Full-page loading overlay */}
      {isSigningIn && (
        <View
          className="absolute inset-0 z-50 items-center justify-center bg-background"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        >
          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="white" />
          </View>
        </View>
      )}
    </>
  );
}

export default function Index() {
  const queryClient = useQueryClient();

  const postQuery = useQuery(trpc.post.all.queryOptions());

  const deletePostMutation = useMutation(
    trpc.post.delete.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries(trpc.post.all.queryFilter()),
    }),
  );

  const { data: session } = authClient.useSession();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  useEffect(() => {
    if (session) {
      console.log("[Login] Redirecting to camera");
      navigation.reset({ index: 0, routes: [{ name: "Camera" }] });
    }
  }, [session, navigation]);

  return (
    <SafeAreaView className="bg-background">
      {/* Title is handled by stack options in RootNavigator; keeping UI only */}
      <View className="h-full w-full bg-background p-4">
        <Text variant="h1" className="pb-4 text-primary">
          whisp
        </Text>

        <MobileAuth />

        <View className="py-4">
          <Text variant="muted" className="italic">
            Press on a post to view details
          </Text>
        </View>

        <LegendList
          data={postQuery.data ?? []}
          estimatedItemSize={20}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-2" />}
          renderItem={(p) => (
            <PostCard
              post={p.item}
              onDelete={() => deletePostMutation.mutate(p.item.id)}
            />
          )}
        />

        <CreatePost />
      </View>
    </SafeAreaView>
  );
}
