import type {
  BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import type { MutableRefObject, ReactElement } from "react";
import { Pressable } from "react-native";
import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  BottomSheetView,
  BottomSheetModal as GorhomBottomSheetModal,
} from "@gorhom/bottom-sheet";

import type { FriendRow } from "./types";
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
  const discordId = selectedFriend?.discordId;
  return (
    <GorhomBottomSheetModal
      ref={bottomSheetRef}
      enableDynamicSizing
      enablePanDownToClose
      enableDismissOnClose
      backdropComponent={renderBackdrop}
      onDismiss={() => {
        console.log(
          "BottomSheet onDismiss, isShowingDialog:",
          isShowingDialogRef.current,
          "selectedFriend:",
          selectedFriend,
        );
        // Only clear if dialog is not showing (use ref for synchronous check)
        if (!isShowingDialogRef.current) {
          console.log("Clearing selectedFriend in onDismiss");
          clearSelectedFriend();
        }
      }}
      backgroundStyle={{ backgroundColor: "#171717" }}
      handleIndicatorStyle={{ backgroundColor: "#525252" }}
    >
      <BottomSheetView className="px-4 pb-8 pt-2">
        <Text className="mb-3 px-2 text-sm font-medium text-muted-foreground">
          {selectedFriend?.name}
        </Text>

        <Pressable
          className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
          onPress={() => {
            if (selectedFriend) {
              onSendWhisp(selectedFriend);
              bottomSheetRef.current?.close();
            }
          }}
        >
          <Ionicons name="camera" size={22} color="#666" />
          <Text className="text-base">Send whisp</Text>
        </Pressable>

        {discordId && (
          <Pressable
            className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
            onPress={() => {
              onViewDiscordProfile(discordId);
              bottomSheetRef.current?.close();
            }}
          >
            <MaterialIcons name="discord" size={22} color="#666" />
            <Text className="text-base">View Discord Profile</Text>
          </Pressable>
        )}

        <Pressable
          className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
          onPress={() => {
            console.log(
              "Remove Friend pressed, selectedFriend:",
              selectedFriend,
            );
            // Use ref to track dialog state synchronously
            isShowingDialogRef.current = true;
            onRemoveFriend();
            bottomSheetRef.current?.close();
          }}
        >
          <Ionicons name="person-remove-outline" size={22} color="#ef4444" />
          <Text className="text-base text-destructive">Remove Friend</Text>
        </Pressable>
      </BottomSheetView>
    </GorhomBottomSheetModal>
  );
}
