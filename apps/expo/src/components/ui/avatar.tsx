import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";

import { trpc } from "~/utils/api";
import { Text } from "./text";

interface AvatarProps {
  userId: string;
  image: string | null;
  name: string;
  size?: number;
}

export function Avatar({ userId, image, name, size = 40 }: AvatarProps) {
  const [hasError, setHasError] = useState(false);
  const [refreshedImage, setRefreshedImage] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const refreshAvatar = trpc.auth.refreshAvatar.useMutation({
    onSuccess: (data) => {
      if (data.success && data.image) {
        setRefreshedImage(data.image);
        setHasError(false);
        void utils.friends.list.invalidate();
      }
    },
  });

  const displayImage = refreshedImage ?? image;
  const showImage = displayImage && !hasError;

  const handleImageError = () => {
    setHasError(true);
    if (!refreshAvatar.isPending && !refreshedImage) {
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
      className="overflow-hidden rounded-full bg-secondary"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <Image
          source={{ uri: displayImage }}
          style={{ width: size, height: size }}
          contentFit="cover"
          onError={handleImageError}
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
