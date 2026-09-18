import { expect, test } from "bun:test";

import {
  isVideoMime,
  mediaKindColor,
  mimeToMediaKind,
  PHOTO_COLOR,
  VIDEO_COLOR,
} from "./media-kind";

test("legacy video formats remain videos", () => {
  for (const mime of ["video/mp4", "video/quicktime", "video/webm"]) {
    expect(isVideoMime(mime)).toBe(true);
    expect(mimeToMediaKind(mime)).toBe("video");
  }
  expect(isVideoMime("image/jpeg")).toBe(false);
});

test("encrypted and unknown media have neutral status instead of photo status", () => {
  for (const mime of ["application/vnd.whisp.mls.v1", undefined, null]) {
    const kind = mimeToMediaKind(mime);
    expect(kind).toBeNull();
    expect(mediaKindColor(kind)).not.toBe(PHOTO_COLOR);
    expect(mediaKindColor(kind)).not.toBe(VIDEO_COLOR);
  }
  expect(mediaKindColor(mimeToMediaKind("image/jpeg"))).toBe(PHOTO_COLOR);
  expect(mediaKindColor(mimeToMediaKind("video/mp4"))).toBe(VIDEO_COLOR);
});
