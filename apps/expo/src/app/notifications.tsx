import { NotificationSettings } from "~/components/notification-settings";
import { SettingsPage } from "~/components/settings-page";

export default function NotificationsScreen() {
  return (
    <SettingsPage title="Notifications">
      <NotificationSettings />
    </SettingsPage>
  );
}
