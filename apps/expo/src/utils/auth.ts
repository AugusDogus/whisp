import * as SecureStore from "expo-secure-store";

import { expoClient } from "@better-auth/expo/client";
import { createAuthClient } from "better-auth/react";

import { getBaseUrl } from "./base-url";

export const authClient = createAuthClient({
  baseURL: getBaseUrl(),
  // New Expo clients perform their own browser state-cookie handoff.
  fetchOptions: { headers: { "x-whisp-auth-client": "1.6" } },
  plugins: [
    expoClient({
      // expoClient reads this build's scheme from Expo config.
      storagePrefix: "whisp",
      storage: SecureStore,
    }),
  ],
});
