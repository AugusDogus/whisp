import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { LayoutChangeEvent } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ResizeMode, Video } from "expo-av";
import { Image } from "expo-image";
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";

import type { Annotation } from "@acme/validators";

import type { CaptionData } from "~/components/caption-editor";
import type { RootStackParamList } from "~/navigation/types";
import { CaptionEditor } from "~/components/caption-editor";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { uploadMedia } from "~/utils/media-upload";

export default function MediaScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Media">>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { path, type, defaultRecipientId } = route.params;

  const source = useMemo(() => ({ uri: `file://${path}` }), [path]);
  const isFocused = useIsFocused();
  const videoRef = useRef<Video>(null);

  // Caption state - support multiple captions
  const [captions, setCaptions] = useState<CaptionData[]>([]);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [containerLayout, setContainerLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Debug render
  useEffect(() => {
    console.log("[Media] State changed:", {
      captionCount: captions.length,
      isEditing: !!editingCaptionId,
    });
  }, [captions, editingCaptionId]);

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

  // Android back button handler
  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (editingCaptionId) {
        Keyboard.dismiss();
        setEditingCaptionId(null);
        return true; // Handled
      }
      return false; // Let default behavior (navigate back) happen
    });
    return () => handler.remove();
  }, [editingCaptionId]);

  // Handle container layout
  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setContainerLayout({ width, height });
  }

  // Caption handlers
  function handleTapCreate(x: number, y: number) {
    console.log("[Media] handleTapCreate called", { x, y });
    const newCaption: CaptionData = {
      id: `caption-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: "",
      x,
      y,
      fontSize: 16,
      color: "#FFFFFF",
    };
    console.log("[Media] Adding caption:", newCaption);
    setCaptions((prev) => [...prev, newCaption]);
    setEditingCaptionId(newCaption.id);
  }

  function handleCaptionUpdate(updatedCaption: CaptionData) {
    setCaptions((prev) =>
      prev.map((c) => (c.id === updatedCaption.id ? updatedCaption : c)),
    );
  }

  function handleDeleteCaption(id: string) {
    setCaptions((prev) => prev.filter((c) => c.id !== id));
    setEditingCaptionId(null);
  }

  function handleStartEditing(id: string) {
    setEditingCaptionId(id);
  }

  function handleStopEditing() {
    // Remove empty captions when stopping edit
    setCaptions((prev) => prev.filter((c) => c.text.trim()));
    setEditingCaptionId(null);
  }

  // Convert captions to annotations format
  function getCaptionAnnotations(): Annotation[] | undefined {
    const validCaptions = captions.filter((c) => c.text.trim());
    if (validCaptions.length === 0) return undefined;

    return validCaptions.map((caption, index) => ({
      id: `annotation-${Date.now()}-${index}`,
      type: "caption" as const,
      text: caption.text,
      x: caption.x,
      y: caption.y,
      fontSize: caption.fontSize,
      color: caption.color,
    }));
  }

  return (
    <View style={styles.container} onLayout={handleLayout}>
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

      {/* Caption Editor Overlay */}
      {containerLayout && (
        <>
          {console.log("[Media] Rendering CaptionEditor with:", {
            captionCount: captions.length,
            editingId: editingCaptionId,
            containerLayout,
          })}
          <CaptionEditor
            captions={captions}
            editingCaptionId={editingCaptionId}
            onUpdate={handleCaptionUpdate}
            onDelete={handleDeleteCaption}
            onStartEditing={handleStartEditing}
            onStopEditing={handleStopEditing}
            onTapCreate={handleTapCreate}
            containerWidth={containerLayout.width}
            containerHeight={containerLayout.height}
          />
        </>
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
          {editingCaptionId && (
            <Button className="px-6" onPress={handleStopEditing}>
              <Text>Done</Text>
            </Button>
          )}
          {!editingCaptionId && (
            <Button
              className="px-6"
              onPress={() => {
                const annotations = getCaptionAnnotations();

                // If we have a default recipient, send directly without friend selection
                if (defaultRecipientId) {
                  void uploadMedia({
                    uri: `file://${path}`,
                    type,
                    recipients: [defaultRecipientId],
                    annotations,
                  });
                  // Navigate immediately, don't wait for upload
                  navigation.reset({ index: 0, routes: [{ name: "Main" }] });
                } else {
                  // No default recipient, go to friend selection
                  navigation.navigate("Main", {
                    screen: "Friends",
                    params: {
                      path,
                      type,
                      defaultRecipientId,
                      annotations,
                    },
                  });
                }
              }}
            >
              <Text>Send</Text>
            </Button>
          )}
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
