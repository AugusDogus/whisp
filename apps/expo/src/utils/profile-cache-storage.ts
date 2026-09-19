import type { ProfileCacheStorage } from "./profile-cache";

import { File, Paths } from "expo-file-system";

// Cache storage may be reclaimed by the OS. It is never the source of truth.
export const profileCacheStorage: ProfileCacheStorage = {
  getItem: async (key) => {
    const file = new File(Paths.cache, `${key}.json`);
    return file.exists ? file.text() : null;
  },
  setItem: (key, value) => new File(Paths.cache, `${key}.json`).write(value),
  removeItem: (key) => {
    const file = new File(Paths.cache, `${key}.json`);
    if (file.exists) file.delete();
  },
};
