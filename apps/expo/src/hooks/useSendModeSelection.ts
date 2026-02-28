import { useCallback, useEffect, useState } from "react";

export function useSendModeSelection({
  hasMedia,
  defaultRecipientId,
  defaultGroupId,
  rasterizationPromise,
}: {
  hasMedia: boolean;
  defaultRecipientId: string | undefined;
  defaultGroupId: string | undefined;
  rasterizationPromise: Promise<string> | undefined;
}) {
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(
    new Set(hasMedia && defaultRecipientId ? [defaultRecipientId] : []),
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    hasMedia && defaultGroupId ? defaultGroupId : null,
  );

  useEffect(() => {
    if (hasMedia && defaultRecipientId) {
      setSelectedFriends(new Set([defaultRecipientId]));
      setSelectedGroupId(null);
    }
  }, [hasMedia, defaultRecipientId]);

  useEffect(() => {
    if (hasMedia && defaultGroupId) {
      setSelectedGroupId(defaultGroupId);
      setSelectedFriends(new Set());
    }
  }, [hasMedia, defaultGroupId]);

  const toggleFriend = useCallback((id: string) => {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedGroupId(null);
  }, []);

  const toggleGroup = useCallback((groupId: string) => {
    setSelectedGroupId((prev) => (prev === groupId ? null : groupId));
    setSelectedFriends(new Set());
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
    selectedGroupId,
    toggleFriend,
    toggleGroup,
    rasterizedImagePath,
  };
}
