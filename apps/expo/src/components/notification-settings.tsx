import { SettingsGroup, SettingsRow } from "~/components/settings-group";
import { trpc } from "~/utils/api";

export function NotificationSettings() {
  const utils = trpc.useUtils();
  const { data: preferences } = trpc.notifications.getPreferences.useQuery(
    undefined,
    {
      initialData: () =>
        utils.notifications.getPreferences.getData() ?? {
          notifyOnMessages: true,
          notifyOnFriendActivity: true,
        },
      staleTime: 0,
    },
  );
  const updatePreferences = trpc.notifications.updatePreferences.useMutation({
    onMutate: async (newPrefs) => {
      await utils.notifications.getPreferences.cancel();
      const previousPrefs = utils.notifications.getPreferences.getData();
      utils.notifications.getPreferences.setData(undefined, (old) => {
        if (!old) return old;
        return {
          notifyOnMessages: old.notifyOnMessages,
          notifyOnFriendActivity: old.notifyOnFriendActivity,
          ...newPrefs,
        };
      });
      return { previousPrefs };
    },
    onError: (_err, _newPrefs, context) => {
      if (context?.previousPrefs) {
        utils.notifications.getPreferences.setData(
          undefined,
          context.previousPrefs,
        );
      }
    },
    onSettled: () => {
      void utils.notifications.getPreferences.refetch();
    },
  });

  const handleToggle = (key: keyof typeof preferences) => {
    updatePreferences.mutate({
      [key]: !preferences[key],
    });
  };

  return (
    <SettingsGroup title="Push notifications">
      <SettingsRow
        label="New whisps"
        end={{
          kind: "switch",
          value: preferences.notifyOnMessages,
          onChange: () => handleToggle("notifyOnMessages"),
        }}
      />
      <SettingsRow
        label="Friend requests"
        end={{
          kind: "switch",
          value: preferences.notifyOnFriendActivity,
          onChange: () => handleToggle("notifyOnFriendActivity"),
        }}
      />
    </SettingsGroup>
  );
}
