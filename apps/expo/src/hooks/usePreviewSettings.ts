import { applicationId } from "expo-application";
import * as SecureStore from "expo-secure-store";

import { useStore } from "zustand";

import { PreviewSettings } from "~/utils/preview-settings";

export const isPreviewApp = PreviewSettings.isPreview(applicationId);
const settings = PreviewSettings.create(applicationId, SecureStore);

export function usePreviewSettings() {
  return useStore(settings);
}
