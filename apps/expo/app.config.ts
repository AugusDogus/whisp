import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "whisp",
  slug: "whisp",
  scheme: "whisp",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  updates: {
    fallbackToCacheTimeout: 0,
  },
  newArchEnabled: true,
  assetBundlePatterns: ["**/*"],
  ios: {
    bundleIdentifier: "whisp.chat",
    supportsTablet: true,
    icon: "./assets/icon.png",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: "whisp.chat",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon-foreground.png",
      backgroundImage: "./assets/adaptive-icon-background.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: "#171717",
    },
    edgeToEdgeEnabled: true,
    googleServicesFile:
      process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
  },
  extra: {
    eas: {
      projectId: "9d685be4-a82e-4a29-885f-4fbb76fb008c",
    },
  },
  experiments: {
    tsconfigPaths: true,
    typedRoutes: true,
    reactCanary: true,
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#fafafa",
        image: "./assets/splash-icon.png",
        dark: {
          backgroundColor: "#171717",
          image: "./assets/splash-icon-dark.png",
        },
      },
    ],
    [
      "react-native-vision-camera",
      {
        cameraPermissionText: "$(PRODUCT_NAME) needs access to your Camera.",
        enableMicrophonePermission: true,
        microphonePermissionText:
          "$(PRODUCT_NAME) needs access to your Microphone.",
      },
    ],
  ],
});
