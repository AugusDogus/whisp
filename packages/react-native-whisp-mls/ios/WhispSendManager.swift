import Foundation
import UIKit
import BackgroundTasks

struct SendConfiguration: Decodable { let deviceId: String; let root: String; let uploadthingVersion: String }
struct SendJobStatus: Decodable { let id: String; let status: String }
private struct TransferReceipt: Codable { let deviceId: String; let id: String; let success: Bool }

final class WhispSendManager: NSObject, URLSessionTaskDelegate {
  static let shared = WhispSendManager()
  static let processingIdentifier = "whisp.chat.send"
  static let sessionIdentifier = "whisp.chat.send.transfer"
  private let queue = DispatchQueue(label: "whisp.send", qos: .utility)
  private let lock = NSLock()
  private var completionHandlers: [() -> Void] = []
  private var activeCancellation: SendCancellation?
  private lazy var session: URLSession = {
    let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = true
    config.waitsForConnectivity = true
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()
  private override init() { super.init(); _ = session }
  func register() {
    BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingIdentifier, using: nil) { task in
      let cancellation = SendCancellation()
      task.expirationHandler = { cancellation.cancel() }
      self.queue.async {
        let success = self.run(cancellation)
        task.setTaskCompleted(success: success)
        if !success { self.schedule() }
      }
    }
  }
  func configure(_ config: String?) throws {
    lock.lock(); activeCancellation?.cancel(); lock.unlock()
    try SendVault.set(config)
    if config != nil { resume() }
  }
  func resume() {
    schedule()
    DispatchQueue.main.async {
      let cancellation = SendCancellation()
      let token = UIApplication.shared.beginBackgroundTask(withName: "Prepare encrypted whisp") { cancellation.cancel() }
      self.queue.async {
        _ = self.run(cancellation)
        DispatchQueue.main.async { if token != .invalid { UIApplication.shared.endBackgroundTask(token) } }
      }
    }
  }
  private func schedule() {
    let request = BGProcessingTaskRequest(identifier: Self.processingIdentifier)
    request.requiresNetworkConnectivity = true
    request.earliestBeginDate = Date(timeIntervalSinceNow: 60)
    // OS may reject extra scheduling requests. Durable jobs also resume at launch.
    do { try BGTaskScheduler.shared.submit(request) }
    catch { NSLog("Whisp send scheduling deferred until the next app activation.") }
  }
  private func run(_ cancellation: SendCancellation) -> Bool {
    lock.lock(); activeCancellation = cancellation; lock.unlock()
    defer { lock.lock(); activeCancellation = nil; lock.unlock() }
    do {
      guard let config = try SendVault.get() else { return true }
      let settings = try JSONDecoder().decode(SendConfiguration.self, from: Data(config.utf8))
      let jobs = try JSONDecoder().decode([SendJobStatus].self, from: Data(try listSendJobs(config: config).utf8))
      var complete = true
      for job in jobs where job.status == "uploading" {
        do {
          let receiptURL = try receiptDirectory().appendingPathComponent(settings.deviceId + ":" + job.id)
          if FileManager.default.fileExists(atPath: receiptURL.path) {
            let receipt = try JSONDecoder().decode(TransferReceipt.self, from: Data(contentsOf: receiptURL))
            guard receipt.deviceId == settings.deviceId && receipt.id == job.id else { throw SendError.invalidCheckpoint }
            try completeSendUpload(config: config, id: job.id, success: receipt.success)
            try FileManager.default.removeItem(at: receiptURL)
          }
          var finished = false
          while !finished {
            if cancellation.isCancelled { return false }
            if try SendVault.get() != config { return false }
            let step = try JSONDecoder().decode(SendStep.self, from: Data(try advanceSendJob(config: config, id: job.id).utf8))
            switch step.stage {
            case "compress": try SendCompression.compress(step, cancellation: cancellation)
            case "upload": try enqueueTransfer(step, settings: settings, cancellation: cancellation); finished = true; complete = false
            case "confirm": finished = true; complete = false
            case "sent", "failed": finished = true
            case "continue": break
            default: throw SendError.invalidCheckpoint
            }
          }
        } catch {
          try? pauseSendJob(config: config, id: job.id)
          complete = false
        }
      }
      if !complete { schedule() }
      return complete
    } catch { return false }
  }
  private func enqueueTransfer(_ step: SendStep, settings: SendConfiguration, cancellation: SendCancellation) throws {
    guard let id = step.id, let rawURL = step.url, let url = URL(string: rawURL), url.scheme == "https", let path = step.file else { throw SendError.invalidCheckpoint }
    let description = settings.deviceId + ":" + id
    let existing = DispatchSemaphore(value: 0)
    let tasks = TransferTasks()
    session.getAllTasks { values in tasks.set(values); existing.signal() }
    existing.wait()
    if tasks.get().contains(where: { $0.taskDescription == description }) { return }
    // Delegate writes a receipt before removing a task. Recheck after getAllTasks.
    if FileManager.default.fileExists(atPath: try receiptDirectory().appendingPathComponent(description).path) { return }
    let payload = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("multipart")
    let boundary = "whisp-" + id
    let header = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(id).age\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8)
    // Ciphertext-only body must remain readable to the OS while the phone is locked.
    FileManager.default.createFile(atPath: payload.path, contents: nil, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    let output = try FileHandle(forWritingTo: payload)
    let input = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    defer { try? output.close(); try? input.close() }
    try output.truncate(atOffset: 0)
    try output.write(contentsOf: header)
    while let bytes = try input.read(upToCount: 64 * 1024), !bytes.isEmpty {
      if cancellation.isCancelled { throw SendError.stopped }
      try output.write(contentsOf: bytes)
    }
    try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
    try output.synchronize()
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.setValue(settings.uploadthingVersion, forHTTPHeaderField: "x-uploadthing-version")
    let transfer = session.uploadTask(with: request, fromFile: payload)
    transfer.taskDescription = description
    transfer.resume()
  }
  private func receiptDirectory() throws -> URL {
    let url = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("whisp-send-receipts")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var excluded = url
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try excluded.setResourceValues(values)
    return url
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let description = task.taskDescription else { return }
    let ids = description.split(separator: ":").map(String.init)
    guard ids.count == 2, UUID(uuidString: ids[0]) != nil, UUID(uuidString: ids[1]) != nil else { return }
    do {
      let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
      let receipt = TransferReceipt(deviceId: ids[0], id: ids[1], success: error == nil && (200..<300).contains(status))
      try JSONEncoder().encode(receipt).write(to: receiptDirectory().appendingPathComponent(description), options: .atomic)
      resume()
    } catch { schedule() }
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func handleEvents(_ identifier: String, completion: @escaping () -> Void) {
    guard identifier == Self.sessionIdentifier else { return }
    lock.lock(); completionHandlers.append(completion); lock.unlock()
    _ = session
  }
  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    lock.lock(); let handlers = completionHandlers; completionHandlers.removeAll(); lock.unlock()
    DispatchQueue.main.async { handlers.forEach { $0() } }
  }
}
private final class TransferTasks {
  private let lock = NSLock()
  private var values: [URLSessionTask] = []
  func set(_ tasks: [URLSessionTask]) { lock.lock(); values = tasks; lock.unlock() }
  func get() -> [URLSessionTask] { lock.lock(); defer { lock.unlock() }; return values }
}
