import { expect, test } from "bun:test";
/// <reference types="bun-types/test" />
import { readFile } from "node:fs/promises";

import { DiscordNameplate } from "./discord-nameplate";

test("only accepts saved Discord collectible nameplate URLs", () => {
  expect(
    DiscordNameplate.animationUrl(
      "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/static.png",
    ),
  ).toBe(
    "https://cdn.discordapp.com/assets/collectibles/nameplates/nameplates/twilight/asset.webm",
  );
  for (const url of [
    "https://example.com/nameplates/test/static.png",
    "https://cdn.discordapp.com/assets/collectibles/nameplates/../static.png",
    "https://cdn.discordapp.com/assets/collectibles/nameplates/test/static.png?redirect=elsewhere",
  ])
    expect(DiscordNameplate.animationUrl(url)).toBeNull();
});

test("converts VP9 alpha video into a looping animated WebP without dropping frames", async () => {
  const input = await readFile(
    new URL("./__fixtures__/nameplate.webm", import.meta.url),
  );
  const output = await DiscordNameplate.convert(input);
  expect(output.toString("ascii", 0, 4)).toBe("RIFF");
  expect(output.toString("ascii", 8, 12)).toBe("WEBP");
  const chunks: { type: string; data: Buffer }[] = [];
  for (let offset = 12; offset + 8 <= output.length; ) {
    const size = output.readUInt32LE(offset + 4);
    chunks.push({
      type: output.toString("ascii", offset, offset + 4),
      data: output.subarray(offset + 8, offset + 8 + size),
    });
    offset += 8 + size + (size % 2);
  }
  const flags = chunks.find((chunk) => chunk.type === "VP8X")?.data[0] ?? 0;
  expect(flags & 0x10).toBe(0x10); // Alpha channel present.
  expect(flags & 0x02).toBe(0x02); // Animation present.
  expect(
    chunks.find((chunk) => chunk.type === "ANIM")?.data.readUInt16LE(4),
  ).toBe(0); // Infinite loop.
  const frames = chunks.filter((chunk) => chunk.type === "ANMF");
  expect(frames).toHaveLength(3);
  expect(
    frames.reduce((total, frame) => total + frame.data.readUIntLE(12, 3), 0),
  ).toBe(600);
});

test("invalid video fails conversion instead of caching a success-shaped fallback", async () => {
  await expect(
    DiscordNameplate.convert(Buffer.from("not a video")),
  ).rejects.toThrow();
});
