import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { RESULTS } from "react-native-permissions";
import Reanimated, {
  useAnimatedProps,
  useSharedValue,
} from "react-native-reanimated";
import type {
  CameraProps,
  CameraRuntimeError,
  PhotoFile,
  VideoFile,
} from "react-native-vision-camera";
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
} from "react-native-vision-camera";

import { Image } from "expo-image";
import * as SecureStore from "expo-secure-store";

import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";

import type { CaptureButtonRef } from "~/components/capture-button";
import { CaptureButton } from "~/components/capture-button";
import { FrontFlashOverlay } from "~/components/front-flash-overlay";
import { StatusBarBlurBackground } from "~/components/status-bar-blur-background";
import { Avatar } from "~/components/ui/avatar";
import { useCameraFocus } from "~/hooks/useCameraFocus";
import { useCameraPermissions } from "~/hooks/useCameraPermissions";
import { useIsForeground } from "~/hooks/useIsForeground";
import { usePinchZoom } from "~/hooks/usePinchZoom";
import { usePreferredCameraDevice } from "~/hooks/usePreferredCameraDevice";
import { usePreferredCameraPosition } from "~/hooks/usePreferredCameraPosition";
import { useVolumeKeyShutter } from "~/hooks/useVolumeKeyShutter";
import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import { useCookieStore } from "~/stores/cookie-store";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import {
  CONTENT_SPACING,
  CONTROL_BUTTON_SIZE,
  MAX_ZOOM_FACTOR,
  SCREEN_WIDTH,
  useSafeAreaPadding,
  useScreenHeight,
} from "~/utils/constants";

const ReanimatedCamera = Reanimated.createAnimatedComponent(Camera);
Reanimated.addWhitelistedNativeProps({
  zoom: true,
});

export function useWhispCookie() {
  return useQuery({
    queryKey: ["whisp_cookie"],
    queryFn: async () => {
      const cookieRaw = await SecureStore.getItemAsync("whisp_cookie");
      return cookieRaw;
    },
  });
}

export default function CameraPage(): React.ReactElement {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const cameraRoute = useRoute<RouteProp<MainTabParamList, "Camera">>();
  const defaultRecipientId = cameraRoute.params?.defaultRecipientId;
  const groupId = cameraRoute.params?.groupId;
  const { data: session, isPending, refetch } = authClient.useSession();

  // Query friend info if we have a pre-selected recipient
  const { data: friends = [] } = trpc.friends.list.useQuery(undefined, {
    enabled: !!defaultRecipientId,
  });
  const selectedFriend = defaultRecipientId
    ? friends.find((f) => f.id === defaultRecipientId)
    : null;
  const { checkCookie: _checkCookie } = useCookieStore();
  const camera = useRef<Camera>(null);
  const captureButtonRef = useRef<CaptureButtonRef>(null);
  const [isCameraInitialized, setIsCameraInitialized] = useState(false);
  const { microphonePermission, requestPermissions } = useCameraPermissions();
  const zoom = useSharedValue(1);
  const isPressingButton = useSharedValue(false);

  // Safe area and screen dimensions
  const safeAreaPadding = useSafeAreaPadding();
  const screenHeight = useScreenHeight();

  // check if camera page is active (only when app is foreground AND screen is focused)
  const isForeground = useIsForeground();
  const isFocused = useIsFocused();
  const isActive = isForeground && isFocused;

  const [cameraPosition, setCameraPosition] = usePreferredCameraPosition();
  const [enableHdr, setEnableHdr] = useState(false);
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [enableNightMode, setEnableNightMode] = useState(false);
  const [isFrontFlashActive, setIsFrontFlashActive] = useState(false);

  // camera device settings
  const [preferredDevice] = usePreferredCameraDevice();
  let device = useCameraDevice(cameraPosition);

  if (preferredDevice?.position === cameraPosition) {
    // override default device with the one selected by the user in settings
    device = preferredDevice;
  }

  const [targetFps, setTargetFps] = useState(30);

  const screenAspectRatio = screenHeight / SCREEN_WIDTH;
  const format = useCameraFormat(device, [
    { fps: targetFps },
    { videoAspectRatio: screenAspectRatio },
    { videoResolution: { width: 1920, height: 1080 } },
    { photoAspectRatio: screenAspectRatio },
    { photoResolution: { width: 1920, height: 1080 } },
  ]);

  const fps = Math.min(format?.maxFps ?? 1, targetFps);

  const supportsFlash = device?.hasFlash ?? false;
  const supportsHdr = format?.supportsPhotoHdr;
  const supports60Fps = useMemo(
    () => device?.formats.some((f) => f.maxFps >= 60),
    [device?.formats],
  );
  const canToggleNightMode = device?.supportsLowLightBoost ?? false;

  const minZoom = device?.minZoom ?? 1;
  const maxZoom = Math.min(device?.maxZoom ?? 1, MAX_ZOOM_FACTOR);

  const cameraAnimatedProps = useAnimatedProps<CameraProps>(() => {
    const z = Math.max(Math.min(zoom.value, maxZoom), minZoom);
    return {
      zoom: z,
    };
  }, [maxZoom, minZoom, zoom]);

  const setIsPressingButton = useCallback(
    (_isPressingButton: boolean) => {
      isPressingButton.value = _isPressingButton;
    },
    [isPressingButton],
  );
  const onError = useCallback((error: CameraRuntimeError) => {
    console.error(error);
  }, []);
  const onInitialized = useCallback(() => {
    console.log("Camera initialized!");
    setIsCameraInitialized(true);
  }, []);
  const triggerFrontFlash = useCallback(() => {
    setIsFrontFlashActive(true);
    // Reset after animation completes (50ms fade in + 300ms hold + 200ms fade out = 550ms)
    setTimeout(() => {
      setIsFrontFlashActive(false);
    }, 600);
  }, []);

  const onMediaCaptured = useCallback(
    (media: PhotoFile | VideoFile, type: "photo" | "video") => {
      try {
        // Hint the preview image cache to reduce first render delay
        if (type === "photo") {
          // expo-image respects file:// URIs; fire-and-forget prefetch
          void Image.prefetch(`file://${media.path}`).catch((err) => {
            console.debug("[Media] image prefetch failed", err);
          });
        }
        navigation.navigate("Media", {
          path: media.path,
          type,
          defaultRecipientId,
          groupId,
        });
      } catch (err) {
        console.error("Failed to navigate to Media screen", err);
      }
    },
    [navigation, defaultRecipientId, groupId],
  );
  const onFlipCameraPressed = useCallback(() => {
    setCameraPosition(cameraPosition === "back" ? "front" : "back");
  }, [cameraPosition, setCameraPosition]);
  const onFlashPressed = useCallback(() => {
    setFlash((f) => (f === "off" ? "on" : "off"));
  }, []);

  const { onFocusTap } = useCameraFocus(camera, device?.supportsFocus);
  const onDoubleTap = useCallback(() => {
    onFlipCameraPressed();
  }, [onFlipCameraPressed]);

  const clearSelectedRecipient = useCallback(() => {
    navigation.setParams({ defaultRecipientId: undefined });
    navigation.navigate("Main", { screen: "Friends" });
  }, [navigation]);

  // On focus, revalidate the session in case cookie exists but session expired
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  // Guard: if we have no session after refetch completes, clear cookie and go to Login
  const navigationResetScheduledRef = useRef(false);
  useEffect(() => {
    if (!isPending && !session && !navigationResetScheduledRef.current) {
      navigationResetScheduledRef.current = true;
      void (async () => {
        try {
          await authClient.signOut();
        } catch (err) {
          console.debug("[CameraPage] signOut on invalid session failed", err);
        }
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            navigation.reset({ index: 0, routes: [{ name: "Login" }] });
          }, 300);
        });
      })();
    }
  }, [isPending, session, navigation]);
  useEffect(() => {
    // Reset zoom to it's default everytime the `device` changes.
    zoom.value = device?.neutralZoom ?? 1;
  }, [zoom, device]);

  useVolumeKeyShutter(captureButtonRef, isActive, isCameraInitialized);

  const { pinchGesture } = usePinchZoom(zoom, minZoom, maxZoom);

  useEffect(() => {
    const f =
      format != null
        ? `(${format.photoWidth}x${format.photoHeight} photo / ${format.videoWidth}x${format.videoHeight}@${format.maxFps} video @ ${fps}fps)`
        : undefined;
    console.log(`Camera: ${device?.name} | Format: ${f}`);
  }, [device?.name, format, fps]);

  useEffect(() => {
    if (!isCameraInitialized || !isActive) return;
    void requestPermissions();
  }, [isCameraInitialized, isActive, requestPermissions]);

  useFocusEffect(
    useCallback(() => {
      if (!defaultRecipientId) return;

      const backHandler = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          clearSelectedRecipient();
          return true;
        },
      );

      return () => backHandler.remove();
    }, [clearSelectedRecipient, defaultRecipientId]),
  );

  const videoHdr = format?.supportsVideoHdr && enableHdr;
  const photoHdr = format?.supportsPhotoHdr && enableHdr && !videoHdr;

  // Create styles with current safe area padding
  const styles = createStyles(safeAreaPadding);

  const {
    data: _cookie,
    isLoading: _isLoading,
    error: _cookieError,
  } = useWhispCookie();

  return (
    <View style={styles.container}>
      <GestureDetector gesture={pinchGesture.enabled(isActive)}>
        <Reanimated.View
          onTouchEnd={onFocusTap}
          style={StyleSheet.absoluteFill}
        >
          <GestureDetector
            gesture={Gesture.Tap()
              .numberOfTaps(2)
              .runOnJS(true)
              .onEnd(onDoubleTap)}
          >
            {device && (
              <ReanimatedCamera
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={isActive}
                ref={camera}
                onInitialized={onInitialized}
                onError={onError}
                onStarted={() => console.log("Camera started!")}
                onStopped={() => console.log("Camera stopped!")}
                onPreviewStarted={() => console.log("Preview started!")}
                onPreviewStopped={() => console.log("Preview stopped!")}
                onOutputOrientationChanged={(o) =>
                  console.log(`Output orientation changed to ${o}!`)
                }
                onPreviewOrientationChanged={(o) =>
                  console.log(`Preview orientation changed to ${o}!`)
                }
                onUIRotationChanged={(degrees) =>
                  console.log(`UI Rotation changed: ${degrees}°`)
                }
                format={format}
                fps={fps}
                photoHdr={photoHdr}
                videoHdr={videoHdr}
                photoQualityBalance="speed"
                lowLightBoost={device.supportsLowLightBoost && enableNightMode}
                videoStabilizationMode="off"
                enableZoomGesture={false}
                animatedProps={cameraAnimatedProps}
                exposure={0}
                outputOrientation="preview"
                photo={true}
                video={true}
                audio={microphonePermission === RESULTS.GRANTED}
                enableLocation={false}
              />
            )}
          </GestureDetector>
        </Reanimated.View>
      </GestureDetector>

      <CaptureButton
        ref={captureButtonRef}
        style={styles.captureButton}
        camera={camera}
        onMediaCaptured={onMediaCaptured}
        cameraZoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        flash={flash}
        enabled={isCameraInitialized && isActive}
        setIsPressingButton={setIsPressingButton}
        cameraPosition={cameraPosition}
        onTriggerFrontFlash={triggerFrontFlash}
      />

      {/* Front flash overlay - shown when taking photos with front camera */}
      <FrontFlashOverlay isActive={isFrontFlashActive} />

      <StatusBarBlurBackground />

      {/* Selected friend indicator banner */}
      {selectedFriend && (
        <View style={styles.selectedFriendBanner}>
          <View className="flex-row items-center gap-3 rounded-full bg-black/70 py-2 pl-2 pr-2">
            <Avatar
              userId={selectedFriend.id}
              image={
                (selectedFriend as { image?: string | null }).image ?? null
              }
              name={selectedFriend.name}
              size={32}
            />
            <Text style={[styles.selectedFriendText, { marginLeft: 4 }]}>
              Sending to {selectedFriend.name}
            </Text>
            <Pressable
              onPress={clearSelectedRecipient}
              style={styles.clearButton}
            >
              <Ionicons name="close-outline" size={24} color="white" />
            </Pressable>
          </View>
        </View>
      )}

      <View style={styles.rightButtonRow}>
        <Pressable style={styles.button} onPress={onFlipCameraPressed}>
          <Ionicons name="camera-reverse" color="white" size={24} />
        </Pressable>
        {/* Show flash button for both front (software flash) and back (hardware flash) cameras */}
        {(supportsFlash || cameraPosition === "front") && (
          <Pressable style={styles.button} onPress={onFlashPressed}>
            <Ionicons
              name={flash === "on" ? "flash" : "flash-off"}
              color="white"
              size={24}
            />
          </Pressable>
        )}
        {supports60Fps && (
          <Pressable
            style={styles.button}
            onPress={() => setTargetFps((t) => (t === 30 ? 60 : 30))}
          >
            <Text style={styles.text}>{`${targetFps}\nFPS`}</Text>
          </Pressable>
        )}
        {supportsHdr && (
          <Pressable
            style={styles.button}
            onPress={() => setEnableHdr((h) => !h)}
          >
            <MaterialIcons
              name={enableHdr ? "hdr-on" : "hdr-off"}
              color="white"
              size={24}
            />
          </Pressable>
        )}
        {canToggleNightMode && (
          <Pressable
            style={styles.button}
            onPress={() => setEnableNightMode(!enableNightMode)}
          >
            <Ionicons
              name={enableNightMode ? "moon" : "moon-outline"}
              color="white"
              size={24}
            />
          </Pressable>
        )}
      </View>
    </View>
  );
}

// Create styles with safe area padding - this needs to be moved inside the component
function createStyles(safeAreaPadding: ReturnType<typeof useSafeAreaPadding>) {
  // Calculate spacing for banner when friend is selected
  const bannerHeight = 48; // Height of the banner pill
  const bannerSpacing = 16; // Spacing between banner and capture button

  // Always keep capture button elevated to leave room for potential banner
  // This prevents shifting when banner appears/disappears
  const captureButtonBottom =
    safeAreaPadding.paddingBottom + bannerHeight + bannerSpacing * 2;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "black",
    },
    captureButton: {
      position: "absolute",
      alignSelf: "center",
      bottom: captureButtonBottom,
    },
    button: {
      marginBottom: CONTENT_SPACING,
      width: CONTROL_BUTTON_SIZE,
      height: CONTROL_BUTTON_SIZE,
      borderRadius: CONTROL_BUTTON_SIZE / 2,
      backgroundColor: "rgba(140, 140, 140, 0.3)",
      justifyContent: "center",
      alignItems: "center",
    },
    rightButtonRow: {
      position: "absolute",
      right: safeAreaPadding.paddingRight,
      top: safeAreaPadding.paddingTop,
    },
    leftButtonRow: {
      position: "absolute",
      left: safeAreaPadding.paddingLeft,
      top: safeAreaPadding.paddingTop,
    },
    text: {
      color: "white",
      fontSize: 11,
      fontWeight: "bold",
      textAlign: "center",
    },
    emptyContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    selectedFriendBanner: {
      position: "absolute",
      bottom: safeAreaPadding.paddingBottom + bannerSpacing,
      alignSelf: "center",
      zIndex: 10,
    },
    selectedFriendText: {
      color: "white",
      fontSize: 14,
      fontWeight: "600",
    },
    clearButton: {
      marginLeft: 4,
    },
  });
}
