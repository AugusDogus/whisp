import { expect, test } from "bun:test";

import { localMediaUri } from "./media-uri";

test.each([
  [
    "file:///private/var/mobile/tmp/photo.jpg",
    "file:///private/var/mobile/tmp/photo.jpg",
  ],
  [
    "file:///private/var/mobile/tmp/video.mp4",
    "file:///private/var/mobile/tmp/video.mp4",
  ],
  [
    "/data/user/0/whisp.chat.preview/cache/photo.jpg",
    "file:///data/user/0/whisp.chat.preview/cache/photo.jpg",
  ],
  [
    "file:///private/var/mobile/tmp/caption%20%231.png",
    "file:///private/var/mobile/tmp/caption%20%231.png",
  ],
])("local media %s remains a usable file URL", (path, expected) => {
  const uri = localMediaUri(path);
  expect(uri).toBe(expected);
  expect(localMediaUri(uri)).toBe(expected);
  // The native sender removes the scheme and decodes exactly once.
  expect(decodeURIComponent(uri.slice(7))).toBe(
    decodeURIComponent(expected.slice(7)),
  );
});
