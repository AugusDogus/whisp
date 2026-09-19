import { useCallback, useEffect, useRef } from "react";

import { Image } from "expo-image";
import type { ImageProps } from "expo-image";

// Android's autoplay prop only controls newly loaded resources. Control an
// already displayed image through its native view without remounting it.
export function AnimatedImage({
  autoplay,
  onDisplay,
  ...props
}: ImageProps & { autoplay: boolean }) {
  const ref = useRef<Image>(null);
  const updatePlayback = useCallback(() => {
    const image = ref.current;
    if (!image) return;
    const playback = autoplay ? image.startAnimating() : image.stopAnimating();
    void playback.catch((error: unknown) => {
      console.warn("Could not update profile image playback", error);
    });
  }, [autoplay]);

  useEffect(updatePlayback, [updatePlayback]);

  return (
    <Image
      {...props}
      ref={ref}
      autoplay={autoplay}
      onDisplay={() => {
        updatePlayback();
        onDisplay?.();
      }}
    />
  );
}
