import type { FriendRow } from "./types";
import type {
  BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";

import type { MutableRefObject, ReactElement } from "react";
import { Pressable, useColorScheme } from "react-native";

import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  BottomSheetView,
  BottomSheetModal as GorhomBottomSheetModal,
} from "@gorhom/bottom-sheet";

import { Text } from "~/components/ui/text";

export function FriendActionsSheet({
  bottomSheetRef,
  renderBackdrop,
  selectedFriend,
  isShowingDialogRef,
  clearSelectedFriend,
  onSendWhisp,
  onViewDiscordProfile,
  onRemoveFriend,
}: {
  bottomSheetRef: MutableRefObject<BottomSheetModal | null>;
  renderBackdrop: (props: BottomSheetBackdropProps) => ReactElement;
  selectedFriend: FriendRow | null;
  isShowingDialogRef: MutableRefObject<boolean>;
  clearSelectedFriend: () => void;
  onSendWhisp: (friend: FriendRow) => void;
  onViewDiscordProfile: (discordId: string) => void;
  onRemoveFriend: () => void;
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const iconColor = isDark ? "#aaa" : "#666";
  const discordId = selectedFriend?.discordId;

  return (
    <GorhomBottomSheetModal
      ref={bottomSheetRef}
      enableDynamicSizing
      enablePanDownToClose
      enableDismissOnClose
      backdropComponent={renderBackdrop}
      onDismiss={() => {
        if (!isShowingDialogRef.current) {
          clearSelectedFriend();
        }
      }}
      backgroundStyle={{
        backgroundColor: isDark ? "#171717" : "#ffffff",
      }}
      handleIndicatorStyle={{
        backgroundColor: isDark ? "#525252" : "#d4d4d4",
      }}
    >
      <BottomSheetView className="px-4 pb-8 pt-2">
        <Text className="mb-3 px-2 text-sm font-medium text-muted">
          {selectedFriend?.name}
        </Text>

        <Pressable
          className="active:bg-default flex-row items-center gap-3 rounded-lg px-3 py-3"
          onPress={() => {
            if (selectedFriend) {
              onSendWhisp(selectedFriend);
              bottomSheetRef.current?.close();
            }
          }}
        >
          <Ionicons name="camera" size={22} color={iconColor} />
          <Text className="text-base">Send whisp</Text>
        </Pressable>

        {discordId && (
          <Pressable
            className="active:bg-default flex-row items-center gap-3 rounded-lg px-3 py-3"
            onPress={() => {
              onViewDiscordProfile(discordId);
              bottomSheetRef.current?.close();
            }}
          >
            <MaterialIcons name="discord" size={22} color={iconColor} />
            <Text className="text-base">View Discord Profile</Text>
          </Pressable>
        )}

        <Pressable
          className="active:bg-default flex-row items-center gap-3 rounded-lg px-3 py-3"
          onPress={() => {
            isShowingDialogRef.current = true;
            onRemoveFriend();
            bottomSheetRef.current?.close();
          }}
        >
          <Ionicons name="person-remove" size={22} color="#ef4444" />
          <Text className="text-danger text-base">Remove Friend</Text>
        </Pressable>
      </BottomSheetView>
    </GorhomBottomSheetModal>
  );
}
