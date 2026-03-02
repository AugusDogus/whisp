import type { GroupRow } from "./types";

import { View } from "react-native";

import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";

export function LeaveGroupDialog({
  open,
  setOpen,
  selectedGroup,
  onConfirmLeave,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedGroup: GroupRow | null;
  onConfirmLeave: () => void;
}) {
  return (
    <Dialog isOpen={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Leave Group</Dialog.Title>
          <Dialog.Description>
            Are you sure you want to leave {selectedGroup?.name}? If you&apos;re
            the last member, the group will be deleted.
          </Dialog.Description>
          <View className="flex-row justify-end gap-3 pt-4">
            <Button variant="ghost" size="sm" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onPress={() => {
                onConfirmLeave();
                setOpen(false);
              }}
            >
              Leave
            </Button>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
