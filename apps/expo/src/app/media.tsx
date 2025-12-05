import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { LayoutChangeEvent } from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ResizeMode, Video } from "expo-av";
import { File, Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { AntDesign, Ionicons } from "@expo/vector-icons";
import {
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import {
  Canvas,
  Image as SkiaImage,
  useCanvasRef,
  useImage,
} from "@shopify/react-native-skia";
import { toast } from "sonner-native";

import type { CaptionData } from "~/components/caption-editor";
import type { RootStackParamList } from "~/navigation/types";
import { CaptionEditor } from "~/components/caption-editor";
import { SkiaCaptionRenderer } from "~/components/skia-caption-renderer";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { uploadMedia } from "~/utils/media-upload";
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
    captions: initialCaptions,
  } = route.params;

  const source = useMemo(() => ({ uri: `file://${path}` }), [path]);
  const isFocused = useIsFocused();
  const videoRef = useRef<Video>(null);

  // Skia refs for rasterization
  const canvasRef = useCanvasRef();
  const skiaImage = useImage(`file://${path}`);

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

  // Track save operation state to prevent duplicate saves
  const [isSaving, setIsSaving] = useState(false);

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

  // Reset save state when screen comes into focus
  useEffect(() => {
    if (isFocused) {
      setIsSaving(false);
    }
  }, [isFocused]);

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

      // Always reset to Camera
      navigation.reset({
        index: 0,
        routes: [{ name: "Main", params: { screen: "Camera" } }],
      });
      return true; // Handled
    });
    return () => handler.remove();
  }, [editingCaptionId, navigation]);

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

  // Function to rasterize image with captions in background
  async function rasterizeImage(): Promise<string> {
    console.log("[Media] Starting background rasterization");

    const snapshot = await canvasRef.current?.makeImageSnapshotAsync();
    if (!snapshot) {
      console.error("[Media] Failed to create snapshot");
      throw new Error("Failed to create snapshot");
    }

    const bytes = snapshot.encodeToBytes();

    // Create a File reference in the cache directory
    const tempFile = new File(Paths.cache, `whisp-${Date.now()}.jpg`);

    // Write the bytes to the file
    const writableStream = tempFile.writableStream();
    const writer = writableStream.getWriter();
    await writer.write(bytes);
    await writer.close();

    const tempPath = tempFile.uri.replace(/^file:\/\//, "");
    console.log("[Media] Background rasterization complete:", tempPath);
    return tempPath;
  }

  async function handleSave() {
    // Prevent duplicate saves
    if (isSaving) {
      console.log("[Media] Save already in progress, ignoring");
      return;
    }

    try {
      setIsSaving(true);

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

      if (type === "photo") {
        // For photos, rasterize captions and save
        if (captions.length > 0) {
          console.log("[Media] Rasterizing photo with captions");
          const rasterizedPath = await rasterizeImage();
          await MediaLibrary.saveToLibraryAsync(`file://${rasterizedPath}`);
        } else {
          // No captions, save original
          await MediaLibrary.saveToLibraryAsync(`file://${path}`);
        }
        toast.success("Saved to camera roll");
      } else {
        // For videos, save original and show alert about captions
        await MediaLibrary.saveToLibraryAsync(`file://${path}`);

        // Show one-time alert about captions not being burned in
        const showAlert = await shouldShowVideoSaveAlert();
        if (showAlert) {
          Alert.alert(
            "Video Saved",
            "Captions are not yet supported for video saves. Only the original video was saved.",
            [{ text: "OK" }],
          );
          await markVideoSaveAlertShown();
        } else {
          toast.success("Saved to camera roll");
        }
      }
    } catch (error) {
      console.error("[Media] Failed to save media:", error);
      toast.error("Failed to save media");
    } finally {
      // Always reset the saving state
      setIsSaving(false);
    }
  }

  function handleSend() {
    console.log("[Media] handleSend called");

    // If we have captions and type is photo, start rasterization in background
    if (type === "photo" && captions.length > 0) {
      console.log(
        "[Media] Starting background rasterization and navigating immediately",
      );
      const rasterizationPromise = rasterizeImage();

      if (defaultRecipientId) {
        // For direct send, navigate immediately and upload in background
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
        void rasterizationPromise.then((rasterizedPath) => {
          void uploadMedia({
            uri: `file://${rasterizedPath}`,
            type,
            recipients: [defaultRecipientId],
          });
        });
      } else {
        // For friend selection, navigate immediately with original path
        // Pass rasterization promise to friends screen
        console.log("[Media] Navigating to Friends screen");
        navigation.navigate("Main", {
          screen: "Friends",
          params: {
            path, // Original path for thumbnail
            type,
            defaultRecipientId,
            rasterizationPromise, // Promise for upload
            thumbhash, // Thumbhash for placeholder
            captions, // Caption data for thumbnail overlay
            originalWidth: containerLayout?.width,
            originalHeight: containerLayout?.height,
          },
        });
        console.log("[Media] Navigation dispatched");
      }
    } else {
      // No captions or video - send original
      if (defaultRecipientId) {
        void uploadMedia({
          uri: `file://${path}`,
          type,
          recipients: [defaultRecipientId],
        });
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
      } else {
        navigation.navigate("Main", {
          screen: "Friends",
          params: {
            path,
            type,
            defaultRecipientId,
          },
        });
      }
    }
  }

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {type === "photo" ? (
        <>
          {/* Hidden Canvas for rasterization */}
          {skiaImage && containerLayout && (
            <Canvas
              ref={canvasRef}
              style={[
                StyleSheet.absoluteFill,
                {
                  width: containerLayout.width,
                  height: containerLayout.height,
                },
              ]}
            >
              <SkiaImage
                image={skiaImage}
                fit="cover"
                x={0}
                y={0}
                width={containerLayout.width}
                height={containerLayout.height}
              />
              <SkiaCaptionRenderer
                captions={captions}
                containerWidth={containerLayout.width}
                containerHeight={containerLayout.height}
              />
            </Canvas>
          )}
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
            // Always reset to Camera
            navigation.reset({
              index: 0,
              routes: [{ name: "Main", params: { screen: "Camera" } }],
            });
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
              <View style={{ flex: 1 }} />
              <Button className="px-6" onPress={handleStopEditing}>
                <Text>Done</Text>
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
                <Text>Save</Text>
              </Button>
              <Button
                className="flex-row items-center gap-2 px-6"
                onPress={() => void handleSend()}
              >
                <Text>Send</Text>
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
