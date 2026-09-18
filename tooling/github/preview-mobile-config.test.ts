import type { ConfigContext } from "expo/config";

import { afterEach, expect, test } from "bun:test";

import configure from "../../apps/expo/app.config";
import eas from "../../apps/expo/eas.json";

const context: ConfigContext = {
  config: { name: "whisp", slug: "whisp" },
  projectRoot: "/test/whisp/apps/expo",
  staticConfigPath: null,
  packageJsonPath: null,
};
const previous = {
  APP_VARIANT: process.env.APP_VARIANT,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  GOOGLE_SERVICES_JSON: process.env.GOOGLE_SERVICES_JSON,
};
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("production keeps its existing native identity", () => {
  process.env.APP_VARIANT = "production";
  const config = configure(context);
  expect(config.android?.package).toBe("whisp.chat");
  expect(config.ios?.bundleIdentifier).toBe("whisp.chat");
  expect(config.scheme).toBe("whisp");
});

test("the EAS preview profile selects a separate identity and deep-link scheme", () => {
  process.env.APP_VARIANT = eas.build.preview.env.APP_VARIANT;
  process.env.EXPO_PUBLIC_API_URL = "https://whisp-pr-17.example.com";
  delete process.env.GOOGLE_SERVICES_JSON;
  const config = configure(context);
  expect(config.name).toBe("Whisp Preview");
  expect(config.android?.package).toBe("whisp.chat.preview");
  expect(config.ios?.bundleIdentifier).toBe("whisp.chat.preview");
  expect(config.scheme).toBe("whisp-preview");
  expect(config.android?.googleServicesFile).toBe(
    "./google-services.preview.json",
  );
  expect(config.plugins).toContainEqual([
    "expo-dev-client",
    { addGeneratedScheme: false },
  ]);
});

test.each(["", "invalid-url", "https://whisp.chat", "ftp://example.com"])(
  "preview builds reject missing or production backend %j",
  (url) => {
    process.env.APP_VARIANT = "preview";
    process.env.EXPO_PUBLIC_API_URL = url;
    expect(() => configure(context)).toThrow();
  },
);
