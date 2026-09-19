import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { trpc } from "~/utils/api";

import { AnimatedImage } from "./animated-image";
import { Text } from "./text";

interface AvatarProps {
  userId: string;
  image: string | null;
  name: string;
  size?: number;
  active?: boolean;
  autoplay?: boolean;
}

export function Avatar({
  userId,
  image,
  name,
  size = 40,
  active = true,
  autoplay = true,
}: AvatarProps) {
  const [hasError, setHasError] = useState(false);
  const [refreshedImage, setRefreshedImage] = useState<string | null>(null);
  const attemptedRefresh = useRef(false);
  useEffect(() => {
    if (!active) return;
    setHasError(false);
    setRefreshedImage(null);
    attemptedRefresh.current = false;
  }, [active, image]);
  const utils = trpc.useUtils();

  const refreshAvatar = trpc.auth.refreshAvatar.useMutation({
    onSuccess: (data) => {
      if (data.success && data.image) {
        setRefreshedImage(data.image);
        setHasError(false);
        void utils.friends.list.invalidate();
        void utils.auth.discordProfile.invalidate({ userId });
      }
    },
  });

  const displayImage = refreshedImage ?? image;
  const showImage = displayImage && !hasError;

  const handleImageError = () => {
    setHasError(true);
    if (active && !refreshAvatar.isPending && !attemptedRefresh.current) {
      attemptedRefresh.current = true;
      refreshAvatar.mutate({ userId });
    }
  };

  const getInitial = () => {
    const n = name.trim();
    if (n.length === 0) return "?";
    const cp = n.codePointAt(0);
    if (cp == null) return "?";
    const first = String.fromCodePoint(cp);
    return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
  };

  return (
    <View
      className="bg-default overflow-hidden rounded-full"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <AnimatedImage
          source={{ uri: displayImage }}
          style={{ width: size, height: size }}
          contentFit="cover"
          onError={handleImageError}
          autoplay={active && autoplay}
          accessibilityLabel={`${name}'s avatar`}
        />
      ) : (
        <View className="h-full w-full items-center justify-center">
          <Text className="font-semibold" style={{ fontSize: size * 0.4 }}>
            {getInitial()}
          </Text>
        </View>
      )}
    </View>
  );
}
