import { View } from "react-native";

import { Skeleton } from "~/components/ui/skeleton";

export function FriendRowSkeleton() {
  return (
    <View
      className="flex-row items-center px-4"
      style={{ minHeight: 68 }}
    >
      {/* Avatar skeleton */}
      <Skeleton className="size-11 rounded-full" />
      <View className="ml-3 flex-1 justify-center py-3">
        {/* Name line */}
        <Skeleton className="h-4 w-32" />
        {/* Status line */}
        <Skeleton className="mt-1.5 h-3 w-24" />
      </View>
    </View>
  );
}

export function FriendsListSkeleton() {
  return (
    <View>
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i}>
          <FriendRowSkeleton />
          {i < 7 && <View className="ml-[68px] h-px bg-border" />}
        </View>
      ))}
    </View>
  );
}

export function FriendRowSkeletonWithVariation({ index }: { index: number }) {
  // Vary the width of name skeleton for a more natural look
  const nameWidths = ["w-28", "w-32", "w-36", "w-24", "w-40"];
  const statusWidths = ["w-20", "w-24", "w-28", "w-16", "w-32"];
  const nameWidth = nameWidths[index % nameWidths.length];
  const statusWidth = statusWidths[index % statusWidths.length];

  return (
    <View
      className="flex-row items-center px-4"
      style={{ minHeight: 68 }}
    >
      {/* Avatar skeleton */}
      <Skeleton className="size-11 rounded-full" />
      <View className="ml-3 flex-1 justify-center py-3">
        {/* Name line */}
        <Skeleton className={`h-4 ${nameWidth}`} />
        {/* Status line */}
        <Skeleton className={`mt-1.5 h-3 ${statusWidth}`} />
      </View>
    </View>
  );
}

export function FriendsListSkeletonVaried() {
  return (
    <View>
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i}>
          <FriendRowSkeletonWithVariation index={i} />
          {i < 7 && <View className="ml-[68px] h-px bg-border" />}
        </View>
      ))}
    </View>
  );
}
