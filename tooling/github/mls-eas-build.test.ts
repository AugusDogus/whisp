import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { z } from "zod";

const script = new URL(
  "../../packages/react-native-whisp-mls/scripts/eas-build.mjs",
  import.meta.url,
);

// Execute the real entry point in an isolated process. Record its subprocesses
// instead of downloading toolchains or compiling native libraries in unit tests.
function run(easBuild: string | undefined, platform?: string, fail = false) {
  const result = Bun.spawnSync(
    [
      "node",
      "--input-type=module",
      "--eval",
      `import childProcess from "node:child_process";
       import { syncBuiltinESMExports } from "node:module";
       childProcess.spawnSync = (command, args) => {
         console.log(JSON.stringify([command, ...args]));
         return { status: ${fail ? 1 : 0} };
       };
       syncBuiltinESMExports();
       await import(${JSON.stringify(script.href)});`,
    ],
    {
      env: {
        ...process.env,
        EAS_BUILD: easBuild,
        EAS_BUILD_PLATFORM: platform,
        ANDROID_NDK_HOME: tmpdir(),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = result.stdout.toString().trim();
  return {
    status: result.exitCode,
    error: result.stderr.toString(),
    commands: output
      ? output
          .split("\n")
          .map((line) => z.array(z.string()).parse(JSON.parse(line)))
      : [],
  };
}

test("local installs do not provision native toolchains", () => {
  expect(run(undefined)).toMatchObject({ status: 0, commands: [] });
});

test("platformless EAS jobs generate bindings without mobile toolchains", () => {
  const result = run("true");
  expect(result.status).toBe(0);
  expect(result.commands.at(-1)?.slice(1)).toEqual([
    "scripts/generate-bindings.mjs",
  ]);
  expect(result.commands.flat()).not.toContain("target");
  expect(result.commands.flat()).not.toContain("cargo-ndk");
});

test.each(["android", "ios"])(
  "%s EAS builds still compile native libraries",
  (platform) => {
    const result = run("true", platform);
    expect(result.status).toBe(0);
    expect(result.commands.some((command) => command.includes("target"))).toBe(
      true,
    );
    expect(
      result.commands.some(
        (command) =>
          command.includes("--and-generate") && command.includes(platform),
      ),
    ).toBe(true);
    expect(result.commands.at(-1)?.slice(1)).toEqual([
      "scripts/native-bindings.mjs",
      ...(platform === "android" ? ["--android"] : []),
    ]);
  },
);

test("unsupported EAS platforms fail before invoking build tools", () => {
  const result = run("true", "web");
  expect(result.status).not.toBe(0);
  expect(result.error).toContain("EAS_BUILD_PLATFORM");
  expect(result.commands).toEqual([]);
});

test("toolchain failures stop platformless jobs", () => {
  const result = run("true", undefined, true);
  expect(result.status).not.toBe(0);
  expect(result.error).toContain("failed while building native MLS");
  expect(result.commands.flat()).not.toContain("scripts/generate-bindings.mjs");
});
