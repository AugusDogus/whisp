import { createFingerprintFromSourcesAsync } from "@expo/fingerprint/build/hash/Hash";
import { normalizeOptionsAsync } from "@expo/fingerprint/build/Options";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Bun patch markers do not change native fingerprints across installer versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "whisp-bun-fingerprint-"));
  try {
    const app = join(root, "apps/expo");
    const dependency = join(root, "node_modules/expo-dev-launcher");
    await mkdir(app, { recursive: true });
    await mkdir(dependency, { recursive: true });
    await writeFile(join(app, "package.json"), "{}");
    await writeFile(
      join(app, ".fingerprintignore"),
      await readFile(
        new URL("../../apps/expo/.fingerprintignore", import.meta.url),
      ),
    );
    const source = join(dependency, "native.swift");
    await writeFile(source, "// Patched native implementation");
    const fingerprint = async () =>
      createFingerprintFromSourcesAsync(
        [
          {
            type: "dir",
            filePath: "../../node_modules/expo-dev-launcher",
            reasons: ["expoAutolinkingIos"],
          },
        ],
        app,
        await normalizeOptionsAsync(app, { platforms: ["ios"], silent: true }),
      );
    await writeFile(join(dependency, ".bun-tag-local"), "");
    const before = await fingerprint();
    await rm(join(dependency, ".bun-tag-local"));
    await writeFile(join(dependency, ".bun-tag-eas"), "");
    expect((await fingerprint()).hash).toBe(before.hash);
    await writeFile(source, "// Different native implementation");
    expect((await fingerprint()).hash).not.toBe(before.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pod install preserves the fingerprint while native source changes invalidate it", async () => {
  const root = await mkdtemp(join(tmpdir(), "whisp-fingerprint-"));
  try {
    const app = join(root, "apps/expo");
    const permissions = join(root, "node_modules/react-native-permissions");
    await mkdir(app, { recursive: true });
    await mkdir(permissions, { recursive: true });
    await writeFile(join(app, "package.json"), "{}");
    await writeFile(
      join(app, ".fingerprintignore"),
      await readFile(
        new URL("../../apps/expo/.fingerprintignore", import.meta.url),
      ),
    );
    const podspec = join(permissions, "RNPermissions.podspec");
    const nativeSource = join(permissions, "RNPermissions.mm");
    await writeFile(podspec, 's.source_files = "ios/*.{h,mm}"');
    await writeFile(nativeSource, "// Original native implementation");
    const fingerprint = async () =>
      createFingerprintFromSourcesAsync(
        [
          {
            type: "dir",
            filePath: "../../node_modules/react-native-permissions",
            reasons: ["rncoreAutolinkingIos"],
          },
        ],
        app,
        await normalizeOptionsAsync(app, { platforms: ["ios"], silent: true }),
      );
    const before = await fingerprint();
    await writeFile(podspec, 's.source_files = "ios/Camera/*.{h,mm}"');
    expect((await fingerprint()).hash).toBe(before.hash);
    await writeFile(nativeSource, "// Changed native implementation");
    expect((await fingerprint()).hash).not.toBe(before.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MLS and generator build outputs preserve the fingerprint while Rust changes invalidate it", async () => {
  const root = await mkdtemp(join(tmpdir(), "whisp-mls-fingerprint-"));
  try {
    const app = join(root, "apps/expo");
    const mls = join(root, "packages/react-native-whisp-mls");
    const generator = join(root, "node_modules/uniffi-bindgen-react-native");
    await mkdir(app, { recursive: true });
    await mkdir(join(mls, "rust/src"), { recursive: true });
    await mkdir(join(generator, "cpp"), { recursive: true });
    await writeFile(join(generator, "cpp/runtime.cpp"), "// Native runtime");
    await writeFile(join(app, "package.json"), "{}");
    await writeFile(
      join(app, ".fingerprintignore"),
      await readFile(
        new URL("../../apps/expo/.fingerprintignore", import.meta.url),
      ),
    );
    await writeFile(join(mls, "rust/src/lib.rs"), "// Original implementation");
    const fingerprint = async () =>
      createFingerprintFromSourcesAsync(
        [
          {
            type: "dir",
            filePath: "../../packages/react-native-whisp-mls",
            reasons: ["rncoreAutolinkingIos"],
          },
          {
            type: "dir",
            filePath: "../../node_modules/uniffi-bindgen-react-native",
            reasons: ["rncoreAutolinkingIos"],
          },
        ],
        app,
        await normalizeOptionsAsync(app, { platforms: ["ios"], silent: true }),
      );
    const before = await fingerprint();
    for (const output of [
      "rust/target",
      "src/generated",
      "cpp/generated",
      "build",
      ".cache",
      "android/src/main/jniLibs",
      "android/src/main/generated",
      "ios/generated-core",
      "WhispMlsFramework.xcframework",
    ]) {
      await mkdir(join(mls, output), { recursive: true });
      await writeFile(
        join(mls, output, "artifact"),
        "Platform-dependent output",
      );
    }
    await mkdir(join(generator, "target/debug"), { recursive: true });
    await writeFile(join(generator, "target/debug/bindgen"), "Host binary");
    await writeFile(
      join(generator, "Cargo.lock"),
      "Generated CLI dependency lock",
    );
    expect((await fingerprint()).hash).toBe(before.hash);
    await writeFile(join(mls, "rust/src/lib.rs"), "// Changed implementation");
    expect((await fingerprint()).hash).not.toBe(before.hash);
    const changedRust = await fingerprint();
    await writeFile(join(generator, "cpp/runtime.cpp"), "// Changed runtime");
    expect((await fingerprint()).hash).not.toBe(changedRust.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
