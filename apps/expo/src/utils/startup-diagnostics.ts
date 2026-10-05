import { AppState } from "react-native";

import { File, Paths } from "expo-file-system";
import * as Updates from "expo-updates";

import * as Sentry from "@sentry/react-native";
import { z } from "zod";

import { createStartupErrorReporter } from "./expo-startup-errors";

const oneDay = 24 * 60 * 60 * 1000;
const checkpointSchema = z.number().finite().nonnegative();
const checkpointFile = () =>
  new File(Paths.document, "startup-errors-reported.json");

const report = createStartupErrorReporter({
  readLogs: () => Updates.readLogEntriesAsync(oneDay),
  readCheckpoint: async () => {
    const file = checkpointFile();
    if (!file.exists) return 0;
    const parsed = checkpointSchema.safeParse(Number(await file.text()));
    if (!parsed.success) {
      console.warn(
        "Startup report checkpoint is invalid. Saved errors will be reported again.",
      );
      return 0;
    }
    return parsed.data;
  },
  writeCheckpoint: async (timestamp) =>
    checkpointFile().write(JSON.stringify(timestamp)),
  capture: (entry) => {
    Sentry.captureEvent({
      message: entry.message,
      level: "error",
      timestamp: entry.timestamp / 1000,
      tags: {
        "error.source": "expo-startup-log",
        "expo.error_code": entry.code,
      },
      contexts: {
        expo_startup: {
          original_error: entry.message,
          failed_update_id: entry.updateId ?? "unknown",
          reporting_update_id: Updates.updateId,
          reporting_runtime_version: Updates.runtimeVersion,
          // The log may predate an app update. The event's release identifies
          // the reporting binary, not necessarily the binary that crashed.
          recovered_from_previous_launch: true,
        },
      },
    });
  },
  flush: async () => (await Sentry.getClient()?.flush(5000)) ?? false,
});

export function observeStartupDiagnostics() {
  // Expo's embedded fallback can start with isEnabled=false after an
  // initialization error. Its persisted logs are still readable.
  if (__DEV__) return;
  const attempt = () => {
    if (AppState.currentState !== "active") return;
    void report().catch(() => {
      // Reporting must never prevent startup. Leave logs and checkpoint intact
      // so another foreground transition can retry, without logging their content.
      console.warn(
        "Startup error reports could not be sent. They will retry when whisp is active.",
      );
    });
  };
  const subscription = AppState.addEventListener("change", attempt);
  attempt();
  return () => subscription.remove();
}
