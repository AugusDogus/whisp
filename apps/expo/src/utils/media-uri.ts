/** Camera and compositor paths can already be file URLs on iOS. */
export function localMediaUri(path: string): string {
  return path.startsWith("file://") ? path : `file://${path}`;
}
