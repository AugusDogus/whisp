const path = require("node:path");
const { FileStore } = require("metro-cache");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withUniwindConfig } = require("uniwind/metro");

const config = getSentryExpoConfig(__dirname);

module.exports = withUniwindConfig(withTurborepoManagedCache(config), {
  cssEntryFile: "./src/styles.css",
  polyfills: { rem: 16 },
});

/**
 * Move the Metro cache to the `.cache/metro` folder.
 * If you have any environment variables, you can configure Turborepo to invalidate it when needed.
 *
 * @see https://turborepo.com/docs/reference/configuration#env
 * @param {import('expo/metro-config').MetroConfig} config
 * @returns {import('expo/metro-config').MetroConfig}
 */
function withTurborepoManagedCache(metroConfig) {
  metroConfig.cacheStores = [
    new FileStore({ root: path.join(__dirname, ".cache/metro") }),
  ];
  return metroConfig;
}
