import type { FriendRow } from "./types";

import type { MutableRefObject } from "react";
import { View } from "react-native";

import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";

export function RemoveFriendDialog({
  open,
  setOpen,
  selectedFriend,
  isShowingDialogRef,
  clearSelectedFriendAfterDelay,
  onConfirmRemove,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedFriend: FriendRow | null;
  isShowingDialogRef: MutableRefObject<boolean>;
  clearSelectedFriendAfterDelay: () => void;
  onConfirmRemove: () => void;
}) {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={(nextOpen) => {
        console.log(
          "Dialog onOpenChange:",
          nextOpen,
          "selectedFriend:",
          selectedFriend,
        );
        setOpen(nextOpen);
        isShowingDialogRef.current = nextOpen;
        if (!nextOpen) {
          clearSelectedFriendAfterDelay();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Remove Friend</Dialog.Title>
          <Dialog.Description>
            Are you sure you want to remove {selectedFriend?.name} from your
            friends list? This action cannot be undone.
          </Dialog.Description>
          <View className="flex-row justify-end gap-3 pt-4">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                setOpen(false);
                isShowingDialogRef.current = false;
                clearSelectedFriendAfterDelay();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onPress={() => {
                onConfirmRemove();
                setOpen(false);
                isShowingDialogRef.current = false;
                clearSelectedFriendAfterDelay();
              }}
            >
              Remove
            </Button>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
