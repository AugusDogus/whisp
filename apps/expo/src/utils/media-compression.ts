import { getRealPath, Image, Video } from "react-native-compressor";

/**
 * Compresses an image using WhatsApp-like automatic settings
 * @param uri The file URI of the image to compress
 * @returns The URI of the compressed image, or original URI if compression fails
 */
export async function compressImage(uri: string): Promise<string> {
  try {
    // Follow react-native-compressor docs:
    // - pass a `file://` URI
    // - use getRealPath() for `ph://` (iOS) or `content://` (Android) inputs
    const inputUri =
      uri.startsWith("ph://") || uri.startsWith("content://")
        ? await getRealPath(uri, "image")
        : uri.startsWith("file://")
          ? uri
          : `file://${uri}`;

    console.log("[Compression] Starting image compression:", inputUri);
    const compressedUri = await Image.compress(inputUri, {
      compressionMethod: "auto",
    });

    // iOS can sometimes return `undefined` (or an empty string) without throwing.
    if (typeof compressedUri !== "string" || compressedUri.length === 0) {
      console.warn(
        "[Compression] Image compression returned empty result, using original",
      );
      return inputUri;
    }

    console.log("[Compression] Image compressed successfully:", compressedUri);
    return compressedUri;
  } catch (error) {
    console.warn(
      "[Compression] Image compression failed, using original:",
      error,
    );
    return uri; // Fallback to original if compression fails
  }
}

/**
 * Compresses a video using WhatsApp-like automatic settings
 * @param uri The file URI of the video to compress
 * @returns The URI of the compressed video, or original URI if compression fails
 */
export async function compressVideo(uri: string): Promise<string> {
  try {
    const inputUri =
      uri.startsWith("ph://") || uri.startsWith("content://")
        ? await getRealPath(uri, "video")
        : uri.startsWith("file://")
          ? uri
          : `file://${uri}`;

    console.log("[Compression] Starting video compression:", inputUri);
    const compressedUri = await Video.compress(inputUri, {
      compressionMethod: "auto",
    });

    if (typeof compressedUri !== "string" || compressedUri.length === 0) {
      console.warn(
        "[Compression] Video compression returned empty result, using original",
      );
      return inputUri;
    }

    console.log("[Compression] Video compressed successfully:", compressedUri);
    return compressedUri;
  } catch (error) {
    console.warn(
      "[Compression] Video compression failed, using original:",
      error,
    );
    return uri; // Fallback to original if compression fails
  }
}
