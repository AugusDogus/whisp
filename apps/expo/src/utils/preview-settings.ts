import { createStore } from "zustand/vanilla";

interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface Settings {
  allowSelfMessages: boolean;
  error: string | null;
  setAllowSelfMessages: (enabled: boolean) => void;
}

function isPreview(applicationId: string | null): boolean {
  return applicationId === "whisp.chat.preview";
}

function create(applicationId: string | null, storage: Storage) {
  const available = isPreview(applicationId);
  const key = "preview-send-to-myself";
  let saved = false;
  let error: string | null = null;
  if (available) {
    try {
      saved = storage.getItem(key) === "true";
    } catch {
      error =
        "Could not load this setting. Sending to yourself is off. Try switching it on again.";
    }
  }
  return createStore<Settings>((set) => ({
    allowSelfMessages: saved,
    error,
    setAllowSelfMessages: (enabled) => {
      if (!available) return;
      try {
        storage.setItem(key, String(enabled));
        set({ allowSelfMessages: enabled, error: null });
      } catch {
        set({
          error:
            "Could not save this setting. Your previous choice is unchanged. Try again.",
        });
      }
    },
  }));
}

export const PreviewSettings = { create, isPreview } as const;
