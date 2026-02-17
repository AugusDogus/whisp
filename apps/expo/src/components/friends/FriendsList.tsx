import type { ColorSchemeName, ImageSourcePropType } from "react-native";
import { FlatList, RefreshControl, View } from "react-native";

import type { FriendRow } from "./types";
import { FriendListRow } from "./FriendListRow";

export function FriendsList({
  rows,
  isRefreshing,
  onRefresh,
  whispLogo,
  colorScheme,
  onPressRow,
  onLongPressRow,
}: {
  rows: FriendRow[];
  isRefreshing: boolean;
  onRefresh: () => void | Promise<void>;
  whispLogo: ImageSourcePropType;
  colorScheme: ColorSchemeName;
  onPressRow: (row: FriendRow) => void;
  onLongPressRow: (row: FriendRow) => void;
}) {
  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
      }
      renderItem={({ item }) => (
        <FriendListRow
          item={item}
          whispLogo={whispLogo}
          colorScheme={colorScheme}
          onPress={() => onPressRow(item)}
          onLongPress={() => onLongPressRow(item)}
        />
      )}
      ItemSeparatorComponent={() => (
        <View className="ml-[68px] h-px bg-border" />
      )}
    />
  );
}
