import { View } from "react-native";

import { Skeleton } from "~/components/ui/skeleton";

export function FriendRowSkeleton() {
  return (
    <View className="flex-row items-center justify-between px-4 py-4">
      <View className="flex-row items-center gap-3">
        {/* Avatar skeleton */}
        <Skeleton className="h-10 w-10 rounded-full" />
        {/* Name skeleton - varied widths for more natural look */}
        <Skeleton className="h-4 w-32" />
      </View>
      {/* Status indicator skeleton */}
      <Skeleton className="h-3 w-3 rounded-full" />
    </View>
  );
}

export function FriendsListSkeleton() {
  return (
    <View>
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i}>
          <FriendRowSkeleton />
          {i < 7 && <View className="h-px bg-border" />}
        </View>
      ))}
    </View>
  );
}

export function FriendRowSkeletonWithVariation({ index }: { index: number }) {
  // Vary the width of name skeleton for a more natural look
  const widths = ["w-28", "w-32", "w-36", "w-24", "w-40"];
  const width = widths[index % widths.length];

  return (
    <View className="flex-row items-center justify-between px-4 py-4">
      <View className="flex-row items-center gap-3">
        {/* Avatar skeleton */}
        <Skeleton className="h-10 w-10 rounded-full" />
        {/* Name skeleton with varied widths */}
        <Skeleton className={`h-4 ${width}`} />
      </View>
      {/* Status indicator skeleton */}
      <Skeleton className="h-3 w-3 rounded-full" />
    </View>
  );
}

export function FriendsListSkeletonVaried() {
  return (
    <View>
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i}>
          <FriendRowSkeletonWithVariation index={i} />
          {i < 7 && <View className="h-px bg-border" />}
        </View>
      ))}
    </View>
  );
}
