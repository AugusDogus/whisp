import Foundation
import UIKit
import AVFoundation
import ImageIO

struct SendStep: Decodable {
  let stage: String
  let kind: String?
  let source: String?
  let output: String?
  let url: String?
  let file: String?
  let id: String?
}
enum SendCompression {
  static func compress(_ step: SendStep, cancellation: SendCancellation) throws {
    guard let source = step.source, let output = step.output else { throw SendError.invalidCheckpoint }
    let destination = URL(fileURLWithPath: output + ".partial")
    let files = FileManager.default
    if files.fileExists(atPath: destination.path) { try files.removeItem(at: destination) }
    defer { if files.fileExists(atPath: destination.path) { try? files.removeItem(at: destination) } }
    if step.kind == "photo" {
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
    } else {
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
