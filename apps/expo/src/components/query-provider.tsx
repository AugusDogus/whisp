import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";

import { focusManager } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";

import { createExpoTRPCClient, trpc } from "~/utils/api";
import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";
import { createProfileCache, createQueryClient } from "~/utils/profile-cache";
import { profileCacheStorage } from "~/utils/profile-cache-storage";
import { clearWhispCiphertexts } from "~/utils/whisp-ciphertext";

function AccountQueries({
  scope,
  children,
}: {
  scope: string | null;
  children: ReactNode;
}) {
  const [queryClient] = useState(createQueryClient);
  const [client] = useState(createExpoTRPCClient);
  const [cache] = useState(() =>
    createProfileCache(scope, profileCacheStorage),
  );
  useEffect(() => {
    const stop = cache.mount();
    return () => {
      stop();
      queryClient.clear();
      if (scope)
        void clearWhispCiphertexts(scope).catch(() => {
          console.warn(
            "Encrypted prefetch cleanup failed. Files will be cleared when Whisp restarts.",
          );
        });
    };
  }, [cache, queryClient, scope]);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={cache.options}
      onError={() =>
        console.warn(
          "Could not restore the profile cache; profiles will load from the server",
        )
      }
    >
      <trpc.Provider client={client} queryClient={queryClient}>
        {children}
      </trpc.Provider>
    </PersistQueryClientProvider>
  );
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  useEffect(() => {
    focusManager.setFocused(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    return () => subscription.remove();
  }, []);
  // Do not expose cached queries until the account owning them is known.
  if (isPending && !session) return null;
  const scope = session?.user
    ? JSON.stringify([getBaseUrl(), session.user.id])
    : null;
  return (
    <AccountQueries key={scope ?? "signed-out"} scope={scope}>
      {children}
    </AccountQueries>
  );
}
