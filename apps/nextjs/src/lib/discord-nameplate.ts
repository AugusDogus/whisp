import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
// Next's shared data cache has a 2 MB entry limit, including base64/JSON overhead.
const MAX_OUTPUT_BYTES = 1400 * 1024;

function animationUrl(staticUrl: string): string | null {
  const match =
    /^https:\/\/cdn\.discordapp\.com\/assets\/collectibles\/(nameplates\/(?:[a-zA-Z0-9_-]+\/)+)static\.png$/.exec(
      staticUrl,
    );
  return match?.[1]
    ? `https://cdn.discordapp.com/assets/collectibles/${match[1]}asset.webm`
    : null;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Discord nameplate download failed: HTTP ${response.status}`,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INPUT_BYTES)
        throw new Error("Discord nameplate exceeds the 8 MB input limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function convert(input: Uint8Array): Promise<Buffer> {
  if (!ffmpegPath)
    throw new Error("No FFmpeg binary is available for this server platform");
  const directory = await mkdtemp(join(tmpdir(), "whisp-nameplate-"));
  try {
    const source = join(directory, "source.webm");
    const output = join(directory, "animated.webp");
    await writeFile(source, input);
    // libvpx is required to decode VP9's alpha plane. Native VP9 decoding drops it.
    await run(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-max_alloc",
        "67108864",
        "-threads",
        "1",
        "-c:v",
        "libvpx-vp9",
        "-protocol_whitelist",
        "file",
        "-i",
        source,
        "-an",
        "-vf",
        "scale=512:-2:flags=lanczos",
        "-c:v",
        "libwebp_anim",
        "-threads",
        "1",
        "-quality",
        "80",
        "-loop",
        "0",
        "-fps_mode",
        "passthrough",
        "-fs",
        String(MAX_OUTPUT_BYTES),
        output,
      ],
      { timeout: 20_000, maxBuffer: 64 * 1024 },
    );
    const data = await readFile(output);
    if (data.byteLength >= MAX_OUTPUT_BYTES)
      throw new Error(
        "Converted Discord nameplate exceeds the cache size limit",
      );
    return data;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Bound cold conversions and share concurrent requests for the same asset.
const inFlight = new Map<string, Promise<string>>();
function load(staticUrl: string): Promise<string> {
  const existing = inFlight.get(staticUrl);
  if (existing) return existing;
  const url = animationUrl(staticUrl);
  if (!url)
    return Promise.reject(
      new Error(
        "Saved Discord nameplate URL is not a supported collectible asset",
      ),
    );
  if (inFlight.size >= 2)
    return Promise.reject(
      new Error("Discord nameplate converter is busy; retry on a later visit"),
    );
  const pending = download(url)
    .then(convert)
    .then((data) => data.toString("base64"))
    .finally(() => {
      inFlight.delete(staticUrl);
    });
  inFlight.set(staticUrl, pending);
  return pending;
}

export const DiscordNameplate = { animationUrl, convert, load } as const;
