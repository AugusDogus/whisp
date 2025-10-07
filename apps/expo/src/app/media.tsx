import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ResizeMode, Video } from "expo-av";
import { Image } from "expo-image";
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";

import type { RootStackParamList } from "~/navigation/types";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

export default function MediaScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Media">>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { path, type, defaultRecipientId } = route.params;

  const source = useMemo(() => ({ uri: `file://${path}` }), [path]);
  const isFocused = useIsFocused();
  const videoRef = useRef<Video>(null);

  useEffect(() => {
    if (type !== "video") return;
    const ref = videoRef.current;
    if (!ref) return;
    if (isFocused) {
      ref.playAsync().catch((err) => {
        console.debug("[Media] playAsync failed", err);
      });
    } else {
      ref.pauseAsync().catch((err) => {
        console.debug("[Media] pauseAsync failed", err);
      });
    }
  }, [isFocused, type]);

  return (
    <View style={styles.container}>
      {type === "photo" ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
      ) : (
        <Video
          ref={videoRef}
          source={source}
          style={StyleSheet.absoluteFill}
          resizeMode={ResizeMode.COVER}
          isLooping
          shouldPlay
          useNativeControls={false}
        />
      )}

      <SafeAreaView edges={["bottom"]} style={styles.controlsSafeArea}>
        <View style={styles.controlsRow}>
          <Button
            variant="secondary"
            className="px-6"
            onPress={() => navigation.goBack()}
          >
            <Text>Cancel</Text>
          </Button>
          <Button
            className="px-6"
            onPress={() =>
              navigation.navigate("Main", {
                screen: "Friends",
                params: {
                  path,
                  type,
                  defaultRecipientId,
                },
              })
            }
          >
            <Text>Send</Text>
          </Button>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },
  controlsSafeArea: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
});
