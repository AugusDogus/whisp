import { useState } from "react";
import { View } from "react-native";

import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";

import { SettingsGroup, SettingsRow } from "~/components/settings-group";
import { SettingsPage } from "~/components/settings-page";
import { Text } from "~/components/ui/text";
import { trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";

export default function AccountScreen() {
  const { data: session } = authClient.useSession();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteAccount = trpc.auth.deleteAccount.useMutation({
    onSuccess: async () => {
      setDeleteDialogOpen(false);
      await authClient.signOut();
    },
  });

  return (
    <SettingsPage title="Account">
      {session?.user && (
        <SettingsGroup title="Account information">
          <SettingsRow
            label="Display name"
            end={{ kind: "value", value: session.user.name }}
          />
          <SettingsRow
            label="Signed in with"
            end={{ kind: "value", value: "Discord" }}
          />
        </SettingsGroup>
      )}

      <SettingsGroup title="Account management">
        <SettingsRow
          label="Delete account"
          tone="danger"
          onPress={() => setDeleteDialogOpen(true)}
        />
      </SettingsGroup>

      <Dialog isOpen={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Delete Account</Dialog.Title>
            <Dialog.Description>
              Are you sure you want to delete your whisp account? This will
              remove your account, messages, groups you created, friendships,
              and reports involving you. Cloud files are queued for deletion.
              This action cannot be undone.
              {"\n\n"}A confirmed serious-abuse decision may retain a protected
              account identifier until its suspension expires. Contact
              augie@luebbers.email to appeal or object to retention.
              {"\n\n"}
              Note: This only deletes your whisp account. Your Discord account
              will remain active.
            </Dialog.Description>
            {deleteAccount.error && (
              <Text accessibilityRole="alert" className="text-danger">
                Account deletion could not be confirmed. Try again. If you are
                signed out, contact augie@luebbers.email for help.
              </Text>
            )}
            <View className="flex-row justify-end gap-3 pt-4">
              <Button
                variant="ghost"
                size="sm"
                onPress={() => setDeleteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                isDisabled={deleteAccount.isPending}
                onPress={() => deleteAccount.mutate()}
              >
                Delete Account
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </SettingsPage>
  );
}
