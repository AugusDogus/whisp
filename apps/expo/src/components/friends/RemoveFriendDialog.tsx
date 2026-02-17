import type { MutableRefObject } from "react";

import type { FriendRow } from "./types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Text } from "~/components/ui/text";

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
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        console.log(
          "AlertDialog onOpenChange:",
          nextOpen,
          "selectedFriend:",
          selectedFriend,
        );
        setOpen(nextOpen);
        isShowingDialogRef.current = nextOpen;
        // Clear selected friend when dialog closes
        if (!nextOpen) {
          clearSelectedFriendAfterDelay();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Friend</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove {selectedFriend?.name} from your
            friends list? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Text>Cancel</Text>
          </AlertDialogCancel>
          <AlertDialogAction onPress={onConfirmRemove}>
            <Text>Remove</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
