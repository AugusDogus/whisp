/**
 * Shared media-kind helpers.
 *
 * Centralises the "photo vs video" distinction so every call-site uses the
 * same type, the same derivation logic, and the same colour palette.
 */

/** The two media types a whisp can be. */
export type MediaKind = "photo" | "video";

/** Derive {@link MediaKind} from a MIME-type string. Defaults to `"photo"`. */
export function mimeToMediaKind(
  mime: string | null | undefined,
): MediaKind {
  if (mime && mime.startsWith("video/")) return "video";
  return "photo";
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
export function mediaKindColor(kind: MediaKind): string {
  return kind === "video" ? VIDEO_COLOR : PHOTO_COLOR;
}
