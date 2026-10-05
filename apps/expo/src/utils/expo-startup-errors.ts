type StartupLogEntry = {
  timestamp: number;
  message: string;
  code: string;
  level: string;
  updateId?: string;
};

/** Expo retains at most 24 hours of logs. Checkpoint only after handing the whole
 * batch to Sentry's native queue (not confirmation of server receipt). Interrupted
 * batches may be repeated; never clear Expo's original logs. */
export function createStartupErrorReporter(input: {
  readLogs(): Promise<StartupLogEntry[]>;
  readCheckpoint(): Promise<number>;
  writeCheckpoint(timestamp: number): Promise<void>;
  capture(entry: StartupLogEntry): void;
  flush(): Promise<boolean>;
}) {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      const checkpoint = await input.readCheckpoint();
      const entries = (await input.readLogs()).filter(
        (entry) =>
          entry.timestamp > checkpoint &&
          ["error", "fatal"].includes(entry.level) &&
          ["JSRuntimeError", "InitializationError"].includes(entry.code),
      );
      if (!entries.length) return;
      // Sentry's native transport has a bounded queue. A synchronous burst can
      // silently drop events even when the final flush succeeds.
      for (const entry of entries) {
        input.capture(entry);
        if (!(await input.flush())) return;
      }
      await input.writeCheckpoint(
        Math.max(...entries.map((entry) => entry.timestamp)),
      );
    } finally {
      running = false;
    }
  };
}
