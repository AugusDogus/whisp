import type { GroupRow } from "./types";

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
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave Group</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to leave {selectedGroup?.name}? If you&apos;re
            the last member, the group will be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Text>Cancel</Text>
          </AlertDialogCancel>
          <AlertDialogAction onPress={onConfirmLeave}>
            <Text>Leave</Text>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
