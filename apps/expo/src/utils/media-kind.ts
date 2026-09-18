/**
 * Shared media-kind helpers.
 *
 * Centralises the "photo vs video" distinction so every call-site uses the
 * same type, the same derivation logic, and the same colour palette.
 */

/** The two media types a whisp can be. */
export type MediaKind = "photo" | "video";

/** Encrypted descriptors do not expose a media kind to the server. */
export function mimeToMediaKind(
  mime: string | null | undefined,
): MediaKind | null {
  if (mime?.startsWith("video/")) return "video";
  if (mime?.startsWith("image/")) return "photo";
  return null;
}

/** Whether a MIME-type string represents a video. */
export function isVideoMime(mime: string | null | undefined): boolean {
  return mimeToMediaKind(mime) === "video";
}

// ── Colour palette ──────────────────────────────────────────────────────

/** Accent colour used for photo statuses (Tailwind red-500). */
export const PHOTO_COLOR = "#ef4444";

/** Accent colour used for video statuses (Tailwind purple-500). */
export const VIDEO_COLOR = "#a855f7";

/** Returns the accent colour for the given media kind. */
export function mediaKindColor(kind: MediaKind | null): string {
  if (kind === "video") return VIDEO_COLOR;
  if (kind === "photo") return PHOTO_COLOR;
  return "#9ca3af";
}
