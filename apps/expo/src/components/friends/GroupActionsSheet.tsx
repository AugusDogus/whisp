import type {
  BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";
import type { MutableRefObject, ReactElement } from "react";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BottomSheetView,
  BottomSheetModal as GorhomBottomSheetModal,
} from "@gorhom/bottom-sheet";

import type { GroupRow } from "./types";
import { Text } from "~/components/ui/text";

export function GroupActionsSheet({
  bottomSheetRef,
  renderBackdrop,
  selectedGroup,
  clearSelectedGroup,
  onOpenGroup,
  onSendWhisp,
  onGroupSettings,
  onLeaveGroup,
}: {
  bottomSheetRef: MutableRefObject<BottomSheetModal | null>;
  renderBackdrop: (props: BottomSheetBackdropProps) => ReactElement;
  selectedGroup: GroupRow | null;
  clearSelectedGroup: () => void;
  onOpenGroup: (group: GroupRow) => void;
  onSendWhisp: (group: GroupRow) => void;
  onGroupSettings: (group: GroupRow) => void;
  onLeaveGroup: (group: GroupRow) => void;
}) {
  return (
    <GorhomBottomSheetModal
      ref={bottomSheetRef}
      enableDynamicSizing
      enablePanDownToClose
      enableDismissOnClose
      backdropComponent={renderBackdrop}
      onDismiss={clearSelectedGroup}
      backgroundStyle={{ backgroundColor: "#171717" }}
      handleIndicatorStyle={{ backgroundColor: "#525252" }}
    >
      <BottomSheetView className="px-4 pb-8 pt-2">
        <Text className="mb-3 px-2 text-sm font-medium text-muted-foreground">
          {selectedGroup?.name}
        </Text>

        <Pressable
          className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
          onPress={() => {
            if (selectedGroup) {
              onOpenGroup(selectedGroup);
              bottomSheetRef.current?.close();
            }
          }}
        >
          <Ionicons name="people" size={22} color="#666" />
          <Text className="text-base">Open group</Text>
        </Pressable>

        <Pressable
          className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
          onPress={() => {
            if (selectedGroup) {
              onSendWhisp(selectedGroup);
              bottomSheetRef.current?.close();
            }
          }}
        >
          <Ionicons name="camera" size={22} color="#666" />
          <Text className="text-base">Send whisp</Text>
        </Pressable>

        <Pressable
          className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
          onPress={() => {
            if (selectedGroup) {
              onGroupSettings(selectedGroup);
              bottomSheetRef.current?.close();
            }
          }}
        >
          <Ionicons name="settings-sharp" size={22} color="#666" />
          <Text className="text-base">Group settings</Text>
        </Pressable>

        <Pressable
          className="flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-accent"
          onPress={() => {
            if (selectedGroup) {
              bottomSheetRef.current?.close();
              onLeaveGroup(selectedGroup);
            }
          }}
        >
          <Ionicons name="log-out-outline" size={22} color="#ef4444" />
          <Text className="text-base text-destructive">Leave group</Text>
        </Pressable>
      </BottomSheetView>
    </GorhomBottomSheetModal>
  );
}
