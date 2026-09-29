import { SettingsRow } from "~/components/settings-group";
import { usePreviewSettings } from "~/hooks/usePreviewSettings";

/** Only meaningful in the preview app; callers gate on `isPreviewApp`. */
export function SendToMyselfRow() {
  const { allowSelfMessages, setAllowSelfMessages, error } =
    usePreviewSettings();

  return (
    <SettingsRow
      label="Send to myself"
      description="Show Me (testing) when choosing recipients. Saved on this device."
      alert={error ?? undefined}
      end={{
        kind: "switch",
        value: allowSelfMessages,
        onChange: setAllowSelfMessages,
      }}
    />
  );
}
