import { createFingerprintFromSourcesAsync } from "@expo/fingerprint/build/hash/Hash";
import { normalizeOptionsAsync } from "@expo/fingerprint/build/Options";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("MLS build outputs preserve the fingerprint while Rust changes invalidate it", async () => {
  const root = await mkdtemp(join(tmpdir(), "whisp-mls-fingerprint-"));
  try {
    const app = join(root, "apps/expo");
    const mls = join(root, "packages/react-native-whisp-mls");
    await mkdir(app, { recursive: true });
    await mkdir(join(mls, "rust/src"), { recursive: true });
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
    expect((await fingerprint()).hash).toBe(before.hash);
    await writeFile(join(mls, "rust/src/lib.rs"), "// Changed implementation");
    expect((await fingerprint()).hash).not.toBe(before.hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
