import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Text,
  TouchableWithoutFeedback,
  View,
} from "react-native";

import { ResizeMode, Video } from "expo-av";
import { Image } from "expo-image";

import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner-native";

import type { ViewerState } from "~/hooks/useMessageViewerState";
import { isVideoMime } from "~/utils/media-kind";
import { openWhisp, type OpenedWhisp } from "~/utils/mls-media";

type MediaState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; deliveryId: string; media: OpenedWhisp };

export function MessageViewerModal({
  viewer,
  insetsTop,
  onRequestClose,
  onTap,
}: {
  viewer: ViewerState | null;
  insetsTop: number;
  onRequestClose: () => void;
  onTap: () => void;
}) {
  const queryClient = useQueryClient();
  const message = viewer?.queue[viewer.index] ?? null;
  const [state, setState] = useState<MediaState>({ kind: "loading" });
  const [progress, setProgress] = useState(0);
  const acknowledged = useRef(new Set<string>());
  const close = useRef(onRequestClose);
  close.current = onRequestClose;
  useEffect(() => {
    if (!viewer) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") close.current();
    });
    return () => subscription.remove();
  }, [viewer]);
  useEffect(() => {
    setState({ kind: "loading" });
    setProgress(0);
    if (!message) return;
    let cancelled = false;
    let opened: OpenedWhisp | undefined;
    void openWhisp(message)
      .then(async (media) => {
        opened = media;
        if (cancelled) {
          await media.dispose();
          return;
        }
        setState({ kind: "ready", deliveryId: message.deliveryId, media });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "This whisp could not be decrypted. Close the viewer and retry. It remains unread.",
          });
      });
    return () => {
      cancelled = true;
      if (opened)
        void opened.dispose().catch(() => {
          console.warn(
            "Temporary whisp cleanup failed; it will be retried on next launch.",
          );
        });
    };
  }, [message]);

  const ready =
    state.kind === "ready" && state.deliveryId === message?.deliveryId
      ? state
      : null;
  const onLoaded = () => {
    if (!ready || acknowledged.current.has(ready.deliveryId)) return;
    acknowledged.current.add(ready.deliveryId);
    void ready.media
      .acknowledge()
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: [["messages", "inbox"]],
        });
        void queryClient.invalidateQueries({ queryKey: [["groups"]] });
        void queryClient.invalidateQueries({ queryKey: [["friends", "list"]] });
      })
      .catch(() => {
        acknowledged.current.delete(ready.deliveryId);
        toast.error(
          "The read receipt could not be saved. This whisp may appear unread until you reopen it.",
        );
      });
  };
  return (
    <Modal
      visible={Boolean(viewer)}
      transparent={false}
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <TouchableWithoutFeedback
        onPress={onTap}
        accessibilityRole="button"
        accessibilityLabel="Next whisp"
      >
        <View className="flex-1 bg-black">
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: insetsTop + 10,
              left: 12,
              right: 12,
              zIndex: 50,
              flexDirection: "row",
              gap: 4,
            }}
          >
            {viewer?.queue.map((item, index) => (
              <View
                key={item?.deliveryId ?? index}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  overflow: "hidden",
                  backgroundColor: "rgba(255,255,255,0.28)",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${index < viewer.index ? 100 : index > viewer.index ? 0 : Math.max(0.12, progress) * 100}%`,
                    backgroundColor: "white",
                  }}
                />
              </View>
            ))}
          </View>
          {state.kind === "error" ? (
            <View className="flex-1 items-center justify-center px-8">
              <Text
                className="text-center text-white"
                accessibilityRole="alert"
              >
                {state.message}
              </Text>
            </View>
          ) : !ready ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator
                color="white"
                accessibilityLabel="Decrypting whisp"
              />
            </View>
          ) : isVideoMime(ready.media.mimeType) ? (
            <Video
              key={ready.deliveryId}
              source={{ uri: ready.media.uri }}
              style={{ width: "100%", height: "100%" }}
              resizeMode={ResizeMode.COVER}
              shouldPlay
              isLooping
              onReadyForDisplay={onLoaded}
              onPlaybackStatusUpdate={(status) => {
                if (status.isLoaded && status.durationMillis)
                  setProgress(
                    Math.min(1, status.positionMillis / status.durationMillis),
                  );
              }}
              onError={() =>
                setState({
                  kind: "error",
                  message:
                    "This video could not be played. Close the viewer and retry. It remains unread.",
                })
              }
            />
          ) : (
            <Image
              key={ready.deliveryId}
              source={{ uri: ready.media.uri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              cachePolicy="none"
              placeholder={
                ready.media.thumbhash
                  ? { thumbhash: ready.media.thumbhash }
                  : undefined
              }
              onLoad={() => {
                setProgress(1);
                onLoaded();
              }}
              onError={() =>
                setState({
                  kind: "error",
                  message:
                    "This image could not be displayed. Close the viewer and retry. It remains unread.",
                })
              }
            />
          )}
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
