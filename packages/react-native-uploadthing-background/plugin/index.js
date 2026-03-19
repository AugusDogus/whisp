// @ts-nocheck

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
} = require("expo/config-plugins");

const pkg = require("../package.json");

function ensurePermission(manifest, permission) {
  const permissions = manifest.manifest["uses-permission"] ?? [];
  const alreadyPresent = permissions.some(
    (item) => item.$["android:name"] === permission,
  );

  if (!alreadyPresent) {
    permissions.push({
      $: {
        "android:name": permission,
      },
    });
  }

  manifest.manifest["uses-permission"] = permissions;
}

function ensureForegroundService(manifest) {
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const existingServices = application.service ?? [];
  const serviceName = "androidx.work.impl.foreground.SystemForegroundService";
  const alreadyPresent = existingServices.some(
    (service) => service.$["android:name"] === serviceName,
  );

  if (!alreadyPresent) {
    existingServices.push({
      $: {
        "android:name": serviceName,
        "android:exported": "false",
        "android:foregroundServiceType": "dataSync",
        "tools:node": "merge",
      },
    });
  }

  application.service = existingServices;
}

const withUploadthingBackground = (config, options = {}) => {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(
      modConfig.modResults,
    );

    if (options.addPostNotificationsPermission !== false) {
      ensurePermission(manifest, "android.permission.POST_NOTIFICATIONS");
    }

    ensureForegroundService(manifest);
    return modConfig;
  });
};

module.exports = createRunOncePlugin(
  withUploadthingBackground,
  pkg.name,
  pkg.version,
);
