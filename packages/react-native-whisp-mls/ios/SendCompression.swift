import Foundation
import UIKit
import AVFoundation
import ImageIO

enum SendCompression {
  static func compress(kind: MediaKind, source: String, output: String, cancellation: SendCancellation) throws {
    let destination = URL(fileURLWithPath: output + ".partial")
    let files = FileManager.default
    if files.fileExists(atPath: destination.path) { try files.removeItem(at: destination) }
    defer { if files.fileExists(atPath: destination.path) { try? files.removeItem(at: destination) } }
    switch kind {
    case .photo:
      // ImageIO downsamples before decoding, applies orientation, and strips EXIF.
      guard let imageSource = CGImageSourceCreateWithURL(URL(fileURLWithPath: source) as CFURL, nil),
        let image = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceCreateThumbnailWithTransform: true,
          kCGImageSourceThumbnailMaxPixelSize: 1280
        ] as CFDictionary),
        let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.82)
      else { throw SendError.compression }
      try jpeg.write(to: destination, options: .completeFileProtection)
    case .video:
      let asset = AVURLAsset(url: URL(fileURLWithPath: source))
      guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720),
        export.supportedFileTypes.contains(.mp4) else { throw SendError.compression }
      export.outputURL = destination
      export.outputFileType = .mp4
      export.shouldOptimizeForNetworkUse = true
      export.metadata = []
      let finished = DispatchSemaphore(value: 0)
      export.exportAsynchronously { finished.signal() }
      while finished.wait(timeout: .now() + 0.25) == .timedOut {
        if cancellation.isCancelled { export.cancelExport(); throw SendError.stopped }
      }
      guard export.status == .completed else { throw SendError.compression }
    }
    if cancellation.isCancelled { throw SendError.stopped }
    let handle = try FileHandle(forWritingTo: destination)
    try handle.synchronize()
    try handle.close()
    try files.moveItem(at: destination, to: URL(fileURLWithPath: output))
  }
}
