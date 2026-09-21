import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("../../apps/expo", import.meta.url));
const autolinker = fileURLToPath(
  new URL(
    "../../node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js",
    import.meta.url,
  ),
);

test("iOS registers the native send module and background session subscriber", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whisp-autolinking-"));
  const target = join(directory, "ExpoModulesProvider.swift");
  try {
    const result = Bun.spawnSync(
      [
        "node",
        autolinker,
        "generate-modules-provider",
        "--target",
        target,
        "--packages",
        "react-native-whisp-mls",
      ],
      { cwd: appRoot, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const provider = await readFile(target, "utf8");
    expect(provider).toContain("import WhispMls");
    expect(provider).toContain("WhispSendModule.self");
    expect(provider).toContain("WhispSendAppDelegateSubscriber.self");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
