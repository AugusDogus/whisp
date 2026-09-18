import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
function run(args) {
  const result = spawnSync("cargo", args, {
    cwd: `${root}/rust`,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["build", "--locked", "--lib"]);
const library =
  process.platform === "darwin" ? "libwhisp_mls.dylib" : "libwhisp_mls.so";
for (const [language, output] of [
  ["kotlin", "../android/src/main/generated"],
  ["swift", "../ios/generated-core"],
]) {
  run([
    "run",
    "--locked",
    "--features",
    "bindgen",
    "--bin",
    "uniffi-bindgen",
    "--",
    "generate",
    "--library",
    `target/debug/${library}`,
    "--language",
    language,
    "--out-dir",
    output,
    "--no-format",
  ]);
}
if (process.argv.includes("--android")) {
  for (const [abi, target] of [
    ["armeabi-v7a", "armv7-linux-androideabi"],
    ["arm64-v8a", "aarch64-linux-android"],
    ["x86", "i686-linux-android"],
    ["x86_64", "x86_64-linux-android"],
  ]) {
    const destination = `${root}/android/src/main/jniLibs/${abi}`;
    mkdirSync(destination, { recursive: true });
    copyFileSync(
      `${root}/rust/target/${target}/release/libwhisp_mls.so`,
      `${destination}/libwhisp_mls.so`,
    );
  }
}
