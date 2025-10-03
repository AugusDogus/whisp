import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

interface CookieStore {
  hasCookie: boolean | null;
  checkCookie: () => Promise<void>;
}

export const useCookieStore = create<CookieStore>((set) => ({
  hasCookie: null,
  checkCookie: async () => {
    try {
      const cookie = await SecureStore.getItemAsync("whisp_cookie");
      console.log("[CookieStore] Cookie check result:", !!cookie);
      set({ hasCookie: !!cookie });
    } catch {
      console.log("[CookieStore] Cookie check failed");
      set({ hasCookie: false });
    }
  },
}));
