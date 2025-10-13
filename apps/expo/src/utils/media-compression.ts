import { Image, Video } from "react-native-compressor";

/**
 * Compresses an image using WhatsApp-like automatic settings
 * @param uri The file URI of the image to compress
 * @returns The URI of the compressed image, or original URI if compression fails
 */
export async function compressImage(uri: string): Promise<string> {
  try {
    console.log("[Compression] Starting image compression:", uri);
    const compressedUri = await Image.compress(uri, {
      compressionMethod: "auto",
    });
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
    console.log("[Compression] Starting video compression:", uri);
    const compressedUri = await Video.compress(uri, {
      compressionMethod: "auto",
    });
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
