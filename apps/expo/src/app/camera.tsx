import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type * as React from "react";
import type { GestureResponderEvent } from "react-native";
import type {
  CameraProps,
  CameraRuntimeError,
  PhotoFile,
  VideoFile,
} from "react-native-vision-camera";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  InteractionManager,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { check, PERMISSIONS, request, RESULTS } from "react-native-permissions";
import Reanimated, {
  Extrapolate,
  interpolate,
  useAnimatedProps,
  useSharedValue,
} from "react-native-reanimated";
import {
  Camera,
  useCameraDevice,
  useCameraFormat,
} from "react-native-vision-camera";
import { VolumeManager } from "react-native-volume-manager";
import { Image } from "expo-image";
import * as SecureStore from "expo-secure-store";
// Gesture handler types no longer needed with new Gesture API
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  useFocusEffect,
  useIsFocused,
  useNavigation,
  useRoute,
} from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";

import type { CaptureButtonRef } from "~/components/capture-button";
import type { MainTabParamList, RootStackParamList } from "~/navigation/types";
import { CaptureButton } from "~/components/capture-button";
import { StatusBarBlurBackground } from "~/components/status-bar-blur-background";
import { useIsForeground } from "~/hooks/useIsForeground";
import { usePreferredCameraDevice } from "~/hooks/usePreferredCameraDevice";
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

const SCALE_FULL_ZOOM = 3;

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
  const [cameraPermission, setCameraPermission] = useState<string>(
    RESULTS.DENIED,
  );
  const [microphonePermission, setMicrophonePermission] = useState<string>(
    RESULTS.DENIED,
  );
  const zoom = useSharedValue(1);
  const isPressingButton = useSharedValue(false);

  // Check permissions on mount
  useEffect(() => {
    async function checkPermissions() {
      const camera = await check(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.CAMERA
          : PERMISSIONS.ANDROID.CAMERA,
      );
      const mic = await check(
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.MICROPHONE
          : PERMISSIONS.ANDROID.RECORD_AUDIO,
      );

      setCameraPermission(camera);
      setMicrophonePermission(mic);
    }

    void checkPermissions();
  }, []);

  // Safe area and screen dimensions
  const safeAreaPadding = useSafeAreaPadding();
  const screenHeight = useScreenHeight();

  // check if camera page is active (only when app is foreground AND screen is focused)
  const isForeground = useIsForeground();
  const isFocused = useIsFocused();
  const isActive = isForeground && isFocused;

  const [cameraPosition, setCameraPosition] = useState<"front" | "back">(
    "back",
  );
  const [enableHdr, setEnableHdr] = useState(false);
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [enableNightMode, setEnableNightMode] = useState(false);

  // camera device settings
  const [preferredDevice] = usePreferredCameraDevice();
  let device = useCameraDevice(cameraPosition);

  if (preferredDevice != null && preferredDevice.position === cameraPosition) {
    // override default device with the one selected by the user in settings
    device = preferredDevice;
  }

  const [targetFps, setTargetFps] = useState(60);

  const screenAspectRatio = screenHeight / SCREEN_WIDTH;
  const format = useCameraFormat(device, [
    { fps: targetFps },
    { videoAspectRatio: screenAspectRatio },
    { videoResolution: "max" },
    { photoAspectRatio: screenAspectRatio },
    { photoResolution: "max" },
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
        });
      } catch (err) {
        console.error("Failed to navigate to Media screen", err);
      }
    },
    [navigation, defaultRecipientId],
  );
  const onFlipCameraPressed = useCallback(() => {
    setCameraPosition((p) => (p === "back" ? "front" : "back"));
  }, []);
  const onFlashPressed = useCallback(() => {
    setFlash((f) => (f === "off" ? "on" : "off"));
  }, []);

  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onFocusTap = useCallback(
    ({ nativeEvent: event }: GestureResponderEvent) => {
      if (!device?.supportsFocus) return;

      // Clear any existing focus timeout to debounce rapid taps
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
      }

      // Debounce focus requests by 100ms to prevent rapid cancellations
      focusTimeoutRef.current = setTimeout(() => {
        camera.current
          ?.focus({
            x: event.locationX,
            y: event.locationY,
          })
          .catch((error: unknown) => {
            // Silently handle focus cancellation errors as they're expected behavior
            if (
              error != null &&
              typeof error === "object" &&
              "code" in error &&
              error.code !== "capture/focus-canceled"
            ) {
              console.error("Focus error:", error);
            }
          });
      }, 100);
    },
    [device?.supportsFocus],
  );
  const onDoubleTap = useCallback(() => {
    onFlipCameraPressed();
  }, [onFlipCameraPressed]);

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

  // Cleanup focus timeout on unmount
  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
      }
    };
  }, []);

  // Volume key shutter functionality with hold-to-record
  useEffect(() => {
    if (!isActive || !isCameraInitialized) return;

    let currentVolume = 0;
    let isVolumeKeyPressed = false;
    let photoTimeout: ReturnType<typeof setTimeout> | null = null;
    let releaseTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastKeyPressTime = 0;
    let isRestoringVolume = false;
    let isRecording = false;

    // Get initial volume to detect changes
    VolumeManager.getVolume()
      .then((result) => {
        currentVolume = result.volume;
      })
      .catch((error) => {
        console.error("Failed to get volume!", error);
      });

    // Suppress native volume UI when camera is active
    void VolumeManager.showNativeVolumeUI({ enabled: false });

    const volumeListener = VolumeManager.addVolumeListener((result) => {
      const now = Date.now();

      // Only trigger on actual volume button press (not programmatic changes)
      if (Math.abs(result.volume - currentVolume) > 0.01) {
        // Reset release timeout for any volume event during recording (even restoration events)
        if (isRecording && releaseTimeout) {
          clearTimeout(releaseTimeout);
          releaseTimeout = setTimeout(() => {
            if (isRecording) {
              isRecording = false;
              isVolumeKeyPressed = false;
              lastKeyPressTime = Date.now();

              // Stop recording
              if (captureButtonRef.current) {
                captureButtonRef.current.endCapture();
              }
            }
          }, 100);
        }

        // Ignore volume changes during restoration
        if (isRestoringVolume) {
          return;
        }

        // Debounce multiple button presses
        if (now - lastKeyPressTime < 1000) {
          return;
        }

        if (!isVolumeKeyPressed) {
          // First event - button press detected
          isVolumeKeyPressed = true;

          // Schedule photo capture after delay - will be canceled if hold is detected
          photoTimeout = setTimeout(() => {
            // Only take photo if we're still in the initial press state (no auto-repeat)
            if (isVolumeKeyPressed && !isRecording) {
              if (captureButtonRef.current) {
                captureButtonRef.current.takePhoto();
              }
              isVolumeKeyPressed = false;
              lastKeyPressTime = Date.now();
            }
          }, 250); // Wait for potential auto-repeat before taking photo
        } else {
          // Subsequent event - auto-repeat detected (user is holding)

          // Only start recording on the FIRST auto-repeat event
          if (!isRecording) {
            // Auto-repeat detected - switch from photo to video
            if (photoTimeout) {
              clearTimeout(photoTimeout);
              photoTimeout = null;
            }

            isRecording = true;

            // Start recording - let the hook handle animation
            if (captureButtonRef.current) {
              captureButtonRef.current.startRecording();
            }
          }

          // Don't reset isVolumeKeyPressed yet - we need to track more auto-repeat events
          // Reset state will happen when recording stops

          // Schedule release detection - if no events for 100ms, user released button
          if (releaseTimeout) {
            clearTimeout(releaseTimeout);
          }
          releaseTimeout = setTimeout(() => {
            if (isRecording) {
              isRecording = false;
              isVolumeKeyPressed = false;
              lastKeyPressTime = Date.now();

              // Stop recording
              if (captureButtonRef.current) {
                captureButtonRef.current.endCapture();
              }
            }
          }, 100);
        }

        // Restore volume immediately to prevent ramping
        isRestoringVolume = true;
        void VolumeManager.setVolume(currentVolume, { showUI: false });
        setTimeout(() => {
          isRestoringVolume = false;
        }, 100);
      }
    });

    return () => {
      volumeListener.remove();

      // Clean up timers
      if (photoTimeout) {
        clearTimeout(photoTimeout);
      }
      if (releaseTimeout) {
        clearTimeout(releaseTimeout);
      }

      // Restore native volume UI when leaving camera
      void VolumeManager.showNativeVolumeUI({ enabled: true });
    };
  }, [isActive, isCameraInitialized]);

  // The gesture handler maps the linear pinch gesture (0 - 1) to an exponential curve since a camera's zoom
  // function does not appear linear to the user. (aka zoom 0.1 -> 0.2 does not look equal in difference as 0.8 -> 0.9)
  const startZoom = useSharedValue(1);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      "worklet";
      // Always sync with current zoom value to prevent flicker
      startZoom.value = zoom.value;
    })
    .onUpdate((event) => {
      "worklet";
      // we're trying to map the scale gesture to a linear zoom here
      const scale = interpolate(
        event.scale,
        [1 - 1 / SCALE_FULL_ZOOM, 1, SCALE_FULL_ZOOM],
        [-1, 0, 1],
        Extrapolate.CLAMP,
      );
      zoom.value = interpolate(
        scale,
        [-1, 0, 1],
        [minZoom, startZoom.value, maxZoom],
        Extrapolate.CLAMP,
      );
    });

  useEffect(() => {
    const f =
      format != null
        ? `(${format.photoWidth}x${format.photoHeight} photo / ${format.videoWidth}x${format.videoHeight}@${format.maxFps} video @ ${fps}fps)`
        : undefined;
    console.log(`Camera: ${device?.name} | Format: ${f}`);
  }, [device?.name, format, fps]);

  useEffect(() => {
    async function requestPermissions() {
      if (cameraPermission !== RESULTS.GRANTED) {
        const result = await request(
          Platform.OS === "ios"
            ? PERMISSIONS.IOS.CAMERA
            : PERMISSIONS.ANDROID.CAMERA,
        );
        setCameraPermission(result);
      }
      if (microphonePermission !== RESULTS.GRANTED) {
        const result = await request(
          Platform.OS === "ios"
            ? PERMISSIONS.IOS.MICROPHONE
            : PERMISSIONS.ANDROID.RECORD_AUDIO,
        );
        setMicrophonePermission(result);
      }
    }

    if (!isCameraInitialized || !isActive) return;
    void requestPermissions();
    // we intentionally only track booleans to avoid effect identity churn
  }, [isCameraInitialized, isActive, cameraPermission, microphonePermission]);

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
      {device != null && cameraPermission === RESULTS.GRANTED ? (
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
                enableZoomGesture={false}
                animatedProps={cameraAnimatedProps}
                exposure={0}
                outputOrientation="device"
                photo={true}
                video={true}
                audio={microphonePermission === RESULTS.GRANTED}
                enableLocation={false}
              />
            </GestureDetector>
          </Reanimated.View>
        </GestureDetector>
      ) : (
        <View style={styles.emptyContainer}>
          <Text style={styles.text}>Your phone does not have a Camera.</Text>
        </View>
      )}

      <CaptureButton
        ref={captureButtonRef}
        style={styles.captureButton}
        camera={camera}
        onMediaCaptured={onMediaCaptured}
        cameraZoom={zoom}
        minZoom={minZoom}
        maxZoom={maxZoom}
        flash={supportsFlash ? flash : "off"}
        enabled={isCameraInitialized && isActive}
        setIsPressingButton={setIsPressingButton}
      />

      <StatusBarBlurBackground />

      {/* Selected friend indicator banner */}
      {selectedFriend && (
        <View style={styles.selectedFriendBanner}>
          <View className="flex-row items-center gap-3 rounded-full bg-black/70 py-2 pl-2 pr-2">
            <View className="h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-secondary">
              {(selectedFriend as { image?: string | null }).image ? (
                <Image
                  source={{
                    uri:
                      (selectedFriend as { image?: string | null }).image ?? "",
                  }}
                  style={{ width: 32, height: 32 }}
                  contentFit="cover"
                />
              ) : (
                <Text style={{ color: "white", fontWeight: "600" }}>
                  {(() => {
                    const n = selectedFriend.name.trim();
                    if (n.length === 0) return "?";
                    const cp = n.codePointAt(0);
                    if (cp == null) return "?";
                    const first = String.fromCodePoint(cp);
                    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
                  })()}
                </Text>
              )}
            </View>
            <Text style={[styles.selectedFriendText, { marginLeft: 4 }]}>
              Sending to {selectedFriend.name}
            </Text>
            <Pressable
              onPress={() => {
                // Clear the pre-selection by resetting navigation params
                navigation.setParams({ defaultRecipientId: undefined });
              }}
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
        {supportsFlash && (
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
