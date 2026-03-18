import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  composeImage,
  composeVideo,
  type MediaCompositorTextOverlay,
} from "react-native-media-compositor";
import { SafeAreaView } from "react-native-safe-area-context";

import { ResizeMode, Video } from "expo-av";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";

import { AntDesign, Ionicons } from "@expo/vector-icons";
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { toast } from "sonner-native";

import type { CaptionData } from "~/components/caption-editor";
import { CaptionEditor } from "~/components/caption-editor";
import type { RootStackParamList } from "~/navigation/types";
import { uploadMedia } from "~/utils/media-upload";
import { markWhispFailed, markWhispUploading } from "~/utils/outbox-status";
import {
  markVideoSaveAlertShown,
  shouldShowVideoSaveAlert,
} from "~/utils/video-save-alert";

export default function MediaScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Media">>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const {
    path,
    type,
    defaultRecipientId,
    groupId,
    captions: initialCaptions,
  } = route.params;

  const source = useMemo(() => ({ uri: `file://${path}` }), [path]);
  const isFocused = useIsFocused();
  const videoRef = useRef<Video>(null);

  // Caption state - support multiple captions
  // Initialize from route params if coming back from Friends screen
  const [captions, setCaptions] = useState<CaptionData[]>(
    initialCaptions ?? [],
  );
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [containerLayout, setContainerLayout] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Generate thumbhash for the image
  const [thumbhash, setThumbhash] = useState<string | undefined>(undefined);

  const exitMedia = useCallback(() => {
    // Prefer going back to whatever opened Media (Friends/Camera/etc).
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    // Fallback for deep links / direct opens without stack history.
    navigation.reset({
      index: 0,
      routes: [{ name: "Main", params: { screen: "Camera" } }],
    });
  }, [navigation]);

  useEffect(() => {
    async function generateThumbhash() {
      try {
        const hash = await Image.generateThumbhashAsync(`file://${path}`);
        setThumbhash(hash);
      } catch (err) {
        console.warn("[Media] Failed to generate thumbhash:", err);
      }
    }
    void generateThumbhash();
  }, [path]);

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

      exitMedia();
      return true; // Handled
    });
    return () => handler.remove();
  }, [editingCaptionId, exitMedia]);

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

  function toOverlay(caption: CaptionData): MediaCompositorTextOverlay {
    const fontSize = caption.fontSize > 0 ? caption.fontSize : 18;
    const previewWidth = containerLayout?.width ?? 0;
    const previewHeight = containerLayout?.height ?? 0;
    const horizontalPadding = 12;
    const verticalPadding = 6;
    const maxTextWidth = Math.max(1, previewWidth - horizontalPadding * 2);
    const approxCharWidth = Math.max(1, fontSize * 0.56);
    const approxCharsPerLine = Math.max(
      1,
      Math.floor(maxTextWidth / approxCharWidth),
    );
    const explicitLines = caption.text.split("\n");

    let lineCount = 0;
    for (const explicitLine of explicitLines) {
      if (explicitLine.trim().length === 0) {
        lineCount += 1;
        continue;
      }

      const words = explicitLine.split(" ");
      let currentLength = 0;
      let wrappedLines = 1;
      for (const word of words) {
        const wordLength = word.length;
        if (currentLength === 0) {
          currentLength = wordLength;
          continue;
        }
        const nextLength = currentLength + 1 + wordLength;
        if (nextLength > approxCharsPerLine) {
          wrappedLines += 1;
          currentLength = wordLength;
        } else {
          currentLength = nextLength;
        }
      }
      lineCount += wrappedLines;
    }

    const safeLineCount = Math.max(1, lineCount);
    const minHeight = fontSize * 1.2 + verticalPadding * 2;
    const bubbleHeight = Math.max(
      minHeight,
      safeLineCount * fontSize * 1.2 + verticalPadding * 2,
    );
    const normalizedHeight =
      previewHeight > 0
        ? Math.min(1, Math.max(0.01, bubbleHeight / previewHeight))
        : 0.16;

    return {
      id: caption.id,
      text: caption.text,
      rect: {
        x: 0,
        y: caption.y,
        width: 1,
        height: normalizedHeight,
      },
      style: {
        fontSize,
        textColor: caption.color || "#FFFFFF",
        backgroundColor: "#99000000",
        paddingHorizontal: horizontalPadding,
        paddingVertical: verticalPadding,
        textAlign: "center",
        opacity: 1,
        cornerRadius: 0,
      },
    };
  }

  async function composeMediaWithCaptions(): Promise<string> {
    if (captions.length === 0) {
      return `file://${path}`;
    }
    if (
      !containerLayout ||
      containerLayout.width <= 0 ||
      containerLayout.height <= 0
    ) {
      throw new Error("Preview is not ready yet.");
    }

    const overlays = captions
      .filter((caption) => caption.text.trim().length > 0)
      .map(toOverlay);
    if (overlays.length === 0) {
      return `file://${path}`;
    }

    if (type === "video") {
      console.log("[Media] Starting video composition");
      const result = await composeVideo({
        inputPath: `file://${path}`,
        preserveAudio: true,
        preview: {
          width: containerLayout.width,
          height: containerLayout.height,
        },
        overlays,
      });
      console.log("[Media] Video composition complete:", result.filePath);
      return result.filePath;
    }

    console.log("[Media] Starting image composition");
    const result = await composeImage({
      inputPath: `file://${path}`,
      outputFormat: "png",
      preview: {
        width: containerLayout.width,
        height: containerLayout.height,
      },
      overlays,
    });
    console.log("[Media] Image composition complete:", result.filePath);
    return result.filePath;
  }

  async function handleSave() {
    try {
      // Haptic feedback on button press
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Request permissions
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== MediaLibrary.PermissionStatus.GRANTED) {
        Alert.alert(
          "Permission Required",
          "We need access to your photo library to save media.",
        );
        return;
      }

      const outputUri =
        captions.length > 0
          ? await composeMediaWithCaptions()
          : `file://${path}`;
      await MediaLibrary.saveToLibraryAsync(outputUri);

      if (type === "video" && captions.length > 0) {
        // Preserve one-time UX guidance while transitioning users to burned-in output.
        const showAlert = await shouldShowVideoSaveAlert();
        if (showAlert) {
          Alert.alert(
            "Video Saved",
            "Captions are now burned into the exported video.",
            [{ text: "OK" }],
          );
          await markVideoSaveAlertShown();
        }
      }

      toast.success("Saved to camera roll");
    } catch (error) {
      console.error("[Media] Failed to save media:", error);
      toast.error("Failed to save media");
    }
  }

  function handleSend() {
    console.log("[Media] handleSend called");

    // If we have captions, compose in the background and navigate immediately.
    if (captions.length > 0) {
      console.log(
        "[Media] Starting background composition and navigating immediately",
      );
      const rasterizationPromise = composeMediaWithCaptions();

      if (defaultRecipientId) {
        markWhispUploading([defaultRecipientId]);
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
        void rasterizationPromise
          .then((composedUri) => {
            void uploadMedia({
              uri: composedUri,
              type,
              recipients: [defaultRecipientId],
              groupId: groupId,
            });
          })
          .catch((err) => {
            console.error("[Media] Rasterization failed:", err);
            markWhispFailed([defaultRecipientId]);
            toast.error("Failed to prepare media");
          });
      } else if (groupId) {
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
        void rasterizationPromise
          .then((composedUri) => {
            void uploadMedia({
              uri: composedUri,
              type,
              recipients: [],
              groupId,
            });
          })
          .catch((err) => {
            console.error("[Media] Rasterization failed:", err);
            toast.error("Failed to prepare media");
          });
      } else {
        navigation.navigate("Main", {
          screen: "Friends",
          params: {
            path,
            type,
            defaultRecipientId,
            groupId,
            rasterizationPromise,
            thumbhash,
            captions,
            originalWidth: containerLayout?.width,
            originalHeight: containerLayout?.height,
          },
        });
      }
    } else {
      if (defaultRecipientId) {
        void uploadMedia({
          uri: `file://${path}`,
          type,
          recipients: [defaultRecipientId],
          groupId,
        });
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
      } else if (groupId) {
        void uploadMedia({
          uri: `file://${path}`,
          type,
          recipients: [],
          groupId,
        });
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
      } else {
        navigation.navigate("Main", {
          screen: "Friends",
          params: {
            path,
            type,
            defaultRecipientId,
            groupId,
          },
        });
      }
    }
  }

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {type === "photo" ? (
        <>
          {/* Display Image (visible to user) */}
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
          />
          {/* Caption Editor Overlay */}
          {containerLayout && (
            <>
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
        </>
      ) : (
        <>
          <Video
            ref={videoRef}
            source={source}
            style={StyleSheet.absoluteFill}
            resizeMode={ResizeMode.COVER}
            isLooping
            shouldPlay
            useNativeControls={false}
          />
          {/* Caption Editor Overlay */}
          {containerLayout && (
            <>
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
        </>
      )}

      {/* Close button - top left */}
      <SafeAreaView edges={["top"]} style={styles.topControlsSafeArea}>
        <Pressable
          onPress={() => {
            exitMedia();
          }}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={32} color="white" />
        </Pressable>
      </SafeAreaView>

      {/* Bottom controls */}
      <SafeAreaView edges={["bottom"]} style={styles.controlsSafeArea}>
        <View style={styles.controlsRow}>
          {editingCaptionId ? (
            <>
              <View className="flex-1" />
              <Button className="px-6" onPress={handleStopEditing}>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                className="flex-row items-center gap-2 px-6"
                onPress={() => void handleSave()}
              >
                <AntDesign name="download" size={18} color="white" />
                <Button.Label>Save</Button.Label>
              </Button>
              <Button
                className="flex-row items-center gap-2 px-6"
                onPress={() => void handleSend()}
              >
                <Button.Label>Send</Button.Label>
                <AntDesign name="send" size={18} color="black" />
              </Button>
            </>
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
  topControlsSafeArea: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
  },
  closeButton: {
    padding: 16,
    alignSelf: "flex-start",
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
