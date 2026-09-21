// Native outputs are gitignored, so EAS must produce them before prebuild/pods.
// Local installs do not download toolchains or rebuild native libraries.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.EAS_BUILD !== "true") process.exit(0);
const platform = process.env.EAS_BUILD_PLATFORM;
if (platform !== undefined && platform !== "android" && platform !== "ios") {
  throw new Error(
    "EAS_BUILD_PLATFORM must be android or ios to build Whisp encryption.",
  );
}
const root = fileURLToPath(new URL("../", import.meta.url));
const cargoBin = join(
  process.env.CARGO_HOME ?? join(homedir(), ".cargo"),
  "bin",
);
const env = {
  ...process.env,
  PATH: `${cargoBin}:${process.env.PATH ?? ""}`,
  RUSTUP_TOOLCHAIN: "1.94.0",
};
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed while building native MLS (exit ${result.status}).`,
    );
}
if (spawnSync("rustup", ["--version"], { env, stdio: "ignore" }).status !== 0) {
  const temporary = mkdtempSync(join(tmpdir(), "whisp-rustup-"));
  try {
    const installer = join(temporary, "rustup.sh");
    run("curl", [
      "--proto",
      "=https",
      "--tlsv1.2",
      "--fail",
      "--silent",
      "--show-error",
      "https://sh.rustup.rs",
      "--output",
      installer,
    ]);
    run("sh", [
      installer,
      "-y",
      "--profile",
      "minimal",
      "--default-toolchain",
      "1.94.0",
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
run("rustup", ["toolchain", "install", "1.94.0", "--profile", "minimal"]);
// EAS fingerprint and update jobs set EAS_BUILD without a target platform.
// Generate the JS bindings Metro needs using the host library; these jobs do
// not have an Android NDK or an iOS SDK for cross-compilation.
if (platform === undefined) {
  run(process.execPath, ["scripts/generate-bindings.mjs"]);
  process.exit(0);
}
if (platform === "android") {
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  const ndk =
    env.ANDROID_NDK_HOME ??
    env.ANDROID_NDK_ROOT ??
    (sdk ? join(sdk, "ndk", "27.1.12297006") : undefined);
  if (!ndk || !existsSync(ndk))
    throw new Error(
      "Install Android NDK 27.1.12297006 and set ANDROID_NDK_HOME before building Whisp MLS.",
    );
  env.ANDROID_NDK_HOME = ndk;
  run("rustup", [
    "target",
    "add",
    "armv7-linux-androideabi",
    "aarch64-linux-android",
    "i686-linux-android",
    "x86_64-linux-android",
  ]);
  run("cargo", ["install", "cargo-ndk", "--version", "4.1.2", "--locked"]);
} else {
  run("rustup", [
    "target",
    "add",
    "aarch64-apple-ios",
    "aarch64-apple-ios-sim",
  ]);
}
const require = createRequire(import.meta.url);
const generator = resolve(
  dirname(require.resolve("uniffi-bindgen-react-native/package.json")),
  "bin/cli.cjs",
);
run(process.execPath, [
  generator,
  "build",
  platform,
  "--config",
  "ubrn.config.yaml",
  "--release",
  "--and-generate",
]);

run(process.execPath, [
  "scripts/native-bindings.mjs",
  ...(platform === "android" ? ["--android"] : []),
]);
