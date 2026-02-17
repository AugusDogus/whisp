import type { AVPlaybackStatus, Video as VideoType } from "expo-av";
import { useEffect, useRef, useState } from "react";
import { Modal, TouchableWithoutFeedback, View } from "react-native";
import { ResizeMode, Video } from "expo-av";
import { Image } from "expo-image";

import type { ViewerState } from "~/hooks/useMessageViewerState";
import { isVideoMime } from "~/utils/media-kind";

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
  const videoRef = useRef<VideoType>(null);

  // Track load/progress for the currently-viewed media so we can render a
  // story-style progress bar (and avoid a "stuck" empty segment).
  const currentViewerMessage = viewer?.queue[viewer.index] ?? null;
  const currentViewerKey =
    currentViewerMessage?.deliveryId ?? currentViewerMessage?.messageId ?? null;
  const [viewerMediaLoaded, setViewerMediaLoaded] = useState(false);
  const [viewerMediaProgress, setViewerMediaProgress] = useState(0);
  const [viewerMediaErrored, setViewerMediaErrored] = useState(false);

  useEffect(() => {
    // Reset when advancing to a different message.
    setViewerMediaLoaded(false);
    setViewerMediaProgress(0);
    setViewerMediaErrored(false);
  }, [currentViewerKey]);

  return (
    <Modal
      visible={Boolean(viewer)}
      transparent={false}
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <TouchableWithoutFeedback onPress={onTap}>
        <View className="flex-1 bg-black">
          {viewer && (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: insetsTop + 10,
                left: 12,
                right: 12,
                zIndex: 50,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              {viewer.queue.map((msg, idx) => {
                const fill =
                  idx < viewer.index
                    ? 1
                    : idx > viewer.index
                      ? 0
                      : // While loading, show a small fill so the bar isn't "invisible".
                        // For video, this will be driven by playback status once loaded.
                        viewerMediaLoaded
                        ? viewerMediaProgress
                        : viewerMediaErrored
                          ? 1
                          : 0.12;

                return (
                  <View
                    key={msg?.deliveryId ?? msg?.messageId ?? `seg-${idx}`}
                    style={{
                      flex: 1,
                      height: 3,
                      borderRadius: 2,
                      overflow: "hidden",
                      backgroundColor: "rgba(255,255,255,0.28)",
                      marginRight: idx === viewer.queue.length - 1 ? 0 : 4,
                    }}
                  >
                    <View
                      style={{
                        height: "100%",
                        width: `${Math.min(1, Math.max(0, fill)) * 100}%`,
                        backgroundColor: "rgba(255,255,255,0.92)",
                      }}
                    />
                  </View>
                );
              })}
            </View>
          )}

          {viewer?.queue[viewer.index]
            ? (() => {
                const m = viewer.queue[viewer.index];
                if (!m) return null;
                const isVideo = isVideoMime(m.mimeType);
                console.log("Rendering message:", {
                  isVideo,
                  mimeType: m.mimeType,
                  fileUrl: m.fileUrl,
                  hasThumbhash: !!m.thumbhash,
                });
                return isVideo ? (
                  <View style={{ width: "100%", height: "100%" }}>
                    {/* Show thumbhash as background while video loads */}
                    {m.thumbhash && (
                      <Image
                        placeholder={{ thumbhash: m.thumbhash }}
                        style={{
                          width: "100%",
                          height: "100%",
                          position: "absolute",
                        }}
                        contentFit="cover"
                      />
                    )}
                    {/* Video renders on top */}
                    <Video
                      ref={videoRef}
                      source={{ uri: m.fileUrl }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode={ResizeMode.COVER}
                      shouldPlay
                      isLooping={true}
                      useNativeControls={false}
                      onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                        if (!status.isLoaded) return;
                        const duration = status.durationMillis ?? 0;
                        if (duration <= 0) return;
                        const progress = status.positionMillis / duration;
                        setViewerMediaProgress(
                          Math.min(1, Math.max(0, progress)),
                        );
                      }}
                      onLoad={async () => {
                        setViewerMediaLoaded(true);
                        // Ensure video plays once loaded
                        console.log("Video loaded, attempting to play");
                        try {
                          const status =
                            await videoRef.current?.getStatusAsync();
                          console.log("Video status:", status);
                          await videoRef.current?.playAsync();
                          console.log("Video play called");
                        } catch (err) {
                          console.error("Error playing video:", err);
                        }
                      }}
                      onError={(error) => {
                        setViewerMediaErrored(true);
                        setViewerMediaLoaded(true);
                        setViewerMediaProgress(1);
                        console.error("Video error:", error);
                      }}
                    />
                  </View>
                ) : (
                  <Image
                    source={{ uri: m.fileUrl }}
                    style={{ width: "100%", height: "100%" }}
                    contentFit="cover"
                    placeholder={
                      m.thumbhash ? { thumbhash: m.thumbhash } : undefined
                    }
                    onLoad={() => {
                      setViewerMediaLoaded(true);
                      setViewerMediaProgress(1);
                    }}
                    onError={() => {
                      setViewerMediaErrored(true);
                      setViewerMediaLoaded(true);
                      setViewerMediaProgress(1);
                    }}
                  />
                );
              })()
            : null}
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
