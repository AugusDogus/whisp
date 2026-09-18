import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const generator = resolve(
  dirname(require.resolve("uniffi-bindgen-react-native/package.json")),
  "bin/cli.cjs",
);

/** @param {string} command @param {string[]} args @param {string} cwd */
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const library =
  process.platform === "darwin"
    ? "libwhisp_mls.dylib"
    : process.platform === "win32"
      ? "whisp_mls.dll"
      : "libwhisp_mls.so";

run("cargo", ["build", "--locked"], resolve(root, "rust"));
run(
  process.execPath,
  [
    generator,
    "generate",
    "jsi",
    "bindings",
    "--library",
    "--no-format",
    "--ts-dir",
    "../src/generated",
    "--cpp-dir",
    "../cpp/generated",
    `target/debug/${library}`,
  ],
  resolve(root, "rust"),
);
