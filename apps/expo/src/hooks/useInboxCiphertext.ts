import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { getBaseUrl } from "~/utils/base-url";
import {
  prefetchWhispCiphertext,
  retainWhispCiphertexts,
} from "~/utils/whisp-ciphertext";
import type { CiphertextMessage } from "~/utils/whisp-ciphertext-cache";

type PrefetchMessage = CiphertextMessage & {
  mimeType?: string;
  createdAt: Date;
};

/** Download at most three recent encrypted whisps ahead of opening, one at a time. */
export function useInboxCiphertext(
  inbox: (PrefetchMessage | null)[],
  userId: string | null,
  enabled: boolean,
) {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const messages = useMemo(
    () =>
      inbox
        .filter(
          (message): message is PrefetchMessage =>
            !!message && message.mimeType === "application/vnd.whisp.mls.v1",
        )
        // eslint-disable-next-line unicorn/no-array-sort -- filter creates a new array; ES2022 target.
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 3),
    [inbox],
  );
  const scope = userId ? JSON.stringify([getBaseUrl(), userId]) : null;
  useEffect(() => {
    // An inactive mounted inbox must not evict the focused screen's ciphertext.
    if (!scope || !enabled || !active) return;
    const accountScope = scope;
    let stopped = false;
    async function prepare() {
      await retainWhispCiphertexts(accountScope, messages);
      for (const message of messages) {
        if (stopped) return;
        try {
          // Stop scheduling on viewer open, but preserve its in-flight transfer
          // so acquire can reuse it after the delivery authorization finishes.
          await prefetchWhispCiphertext(message, accountScope);
        } catch {
          // Speculative failure is not a failed open. The viewer retries on demand
          // and reports its own download error without acknowledging a view.
        }
      }
    }
    void prepare().catch(() =>
      console.warn(
        "Encrypted prefetch cleanup failed. Files will be cleared when Whisp restarts.",
      ),
    );
    return () => {
      stopped = true;
    };
  }, [scope, messages, enabled, active]);
}
