import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? "production";
  if (variant !== "production" && variant !== "preview") {
    throw new Error("APP_VARIANT must be production or preview.");
  }
  const isPreview = variant === "preview";
  if (isPreview) {
    let url: URL;
    try {
      url = new URL(process.env.EXPO_PUBLIC_API_URL ?? "");
    } catch {
      throw new Error(
        "Preview builds require EXPO_PUBLIC_API_URL pointing to the PR backend.",
      );
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      ["whisp.chat", "www.whisp.chat"].includes(url.hostname)
    ) {
      throw new Error(
        "Preview builds must use a preview or local HTTP(S) backend, not whisp.chat.",
      );
    }
  }
  return {
    ...config,
    name: isPreview ? "whisp preview" : "whisp",
    slug: "whisp",
    scheme: isPreview ? "whisp-preview" : "whisp",
    version: "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    updates: {
      enabled: isPreview,
      fallbackToCacheTimeout: 0,
      ...(isPreview && {
        url: "https://u.expo.dev/9d685be4-a82e-4a29-885f-4fbb76fb008c",
      }),
    },
    ...(isPreview && { runtimeVersion: { policy: "fingerprint" as const } }),
    newArchEnabled: true,
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: isPreview ? "whisp.chat.preview" : "whisp.chat",
      supportsTablet: true,
      icon: "./assets/icon.png",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["processing", "remote-notification"],
        BGTaskSchedulerPermittedIdentifiers: ["whisp.chat.send"],
        NSCameraUsageDescription:
          "whisp needs access to your Camera to capture and send photos and videos to your friends.",
        NSMicrophoneUsageDescription:
          "whisp needs access to your Microphone to record videos with sound.",
      },
    },
    android: {
      package: isPreview ? "whisp.chat.preview" : "whisp.chat",
      // Restoring an old MLS snapshot can roll back secret-tree ratchets.
      allowBackup: false,
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon-foreground.png",
        backgroundImage: "./assets/adaptive-icon-background.png",
        monochromeImage: "./assets/adaptive-icon-monochrome.png",
        backgroundColor: "#171717",
      },
      edgeToEdgeEnabled: true,
      googleServicesFile:
        process.env.GOOGLE_SERVICES_JSON ??
        (isPreview
          ? "./google-services.preview.json"
          : "./google-services.json"),
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
      ],
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
      "@rnrepo/expo-config-plugin",
      "expo-router",
      // Keep preview builds from also claiming the production dev-client scheme.
      ["expo-dev-client", { addGeneratedScheme: !isPreview }],
      "expo-secure-store",
      "expo-web-browser",
      "expo-localization",
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
      [
        "expo-notifications",
        {
          icon: "./assets/notification-icon.png",
          color: "#ffffff",
          defaultChannel: "default",
          enableBackgroundRemoteNotifications: true,
        },
      ],
      [
        "react-native-permissions",
        {
          iosPermissions: ["Camera", "Microphone", "Notifications"],
        },
      ],
      "react-native-compressor",
      "react-native-uploadthing-background",
      [
        "@sentry/react-native/expo",
        {
          url: "https://sentry.io/",
          project: "whisp",
          organization: "whisplabs",
        },
      ],
    ],
  };
};
