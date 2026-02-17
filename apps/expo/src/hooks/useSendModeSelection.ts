import { useCallback, useEffect, useState } from "react";

export function useSendModeSelection({
  hasMedia,
  defaultRecipientId,
  rasterizationPromise,
}: {
  hasMedia: boolean;
  defaultRecipientId: string | undefined;
  rasterizationPromise: Promise<string> | undefined;
}) {
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(
    new Set(hasMedia && defaultRecipientId ? [defaultRecipientId] : []),
  );

  // Update selected friends when the defaultRecipientId changes (initial load)
  useEffect(() => {
    if (hasMedia && defaultRecipientId) {
      setSelectedFriends(new Set([defaultRecipientId]));
    }
  }, [hasMedia, defaultRecipientId]);

  const toggleFriend = useCallback((id: string) => {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Wait for rasterization to complete and use rasterized image
  const [rasterizedImagePath, setRasterizedImagePath] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!rasterizationPromise) return;
    void rasterizationPromise.then((path) => {
      // Use requestAnimationFrame to batch the state update with the next frame
      requestAnimationFrame(() => {
        setRasterizedImagePath(path);
      });
    });
  }, [rasterizationPromise]);

  return {
    selectedFriends,
    toggleFriend,
    rasterizedImagePath,
  };
}
