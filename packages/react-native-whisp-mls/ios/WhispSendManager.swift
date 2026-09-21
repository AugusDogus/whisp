import Foundation
import UIKit
import BackgroundTasks

private struct TransferReceipt: Codable { let deviceId: String; let id: String; let success: Bool }

final class WhispSendManager: NSObject, URLSessionTaskDelegate {
  static let shared = WhispSendManager()
  static let processingIdentifier = "whisp.chat.send"
  static let sessionIdentifier = "whisp.chat.send.transfer"
  private let queue = DispatchQueue(label: "whisp.send", qos: .utility)
  private let lock = NSLock()
  private var completionHandlers: [() -> Void] = []
  private var activeCancellation: SendCancellation?
  private var foregroundRetryPending = false
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
  func resume(retryBlocked: Bool = false) {
    schedule()
    DispatchQueue.main.async {
      let cancellation = SendCancellation()
      let token = UIApplication.shared.beginBackgroundTask(withName: "Prepare encrypted whisp") { cancellation.cancel() }
      self.queue.async {
        _ = self.run(cancellation, retryBlocked: retryBlocked)
        DispatchQueue.main.async { if token != .invalid { UIApplication.shared.endBackgroundTask(token) } }
      }
    }
  }
  // BGProcessing is opportunistic and may not run while the app is foregrounded.
  // Only transient failures and pending confirmations request this bounded wakeup.
  private func retryWhenForeground() {
    DispatchQueue.main.async {
      guard UIApplication.shared.applicationState == .active else { return }
      self.lock.lock()
      guard !self.foregroundRetryPending else { self.lock.unlock(); return }
      self.foregroundRetryPending = true
      self.lock.unlock()
      DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
        self.lock.lock(); self.foregroundRetryPending = false; self.lock.unlock()
        if UIApplication.shared.applicationState == .active { self.resume() }
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
  private func run(_ cancellation: SendCancellation, retryBlocked: Bool = false) -> Bool {
    lock.lock(); activeCancellation = cancellation; lock.unlock()
    defer { lock.lock(); activeCancellation = nil; lock.unlock() }
    do {
      guard let config = try SendVault.get() else { return true }
      let settings = try sendWorkerConfig(config: config)
      let jobs = try sendJobStatuses(config: config)
      var complete = true
      for job in jobs where job.status == .uploading || job.status == .blocked {
        defer { WhispSendEvents.notify() }
        do {
          if retryBlocked {
            try retrySendJob(config: config, id: job.id)
            WhispSendEvents.notify()
          }
          let receiptURL = try receiptDirectory().appendingPathComponent(settings.deviceId + ":" + job.id)
          if FileManager.default.fileExists(atPath: receiptURL.path) {
            let receipt = try JSONDecoder().decode(TransferReceipt.self, from: Data(contentsOf: receiptURL))
            guard receipt.deviceId == settings.deviceId && receipt.id == job.id else { throw SendError.invalidCheckpoint }
            try completeSendUpload(config: config, id: job.id, success: receipt.success)
            try FileManager.default.removeItem(at: receiptURL)
            if !receipt.success {
              _ = try pauseSendJob(config: config, id: job.id, reason: .transfer)
              retryWhenForeground()
              complete = false
              continue
            }
          }
          var finished = false
          while !finished {
            if cancellation.isCancelled { return false }
            if try SendVault.get() != config { return false }
            switch try advanceSendJob(config: config, id: job.id) {
            case let .compress(kind, source, output):
              do { try SendCompression.compress(kind: kind, source: source, output: output, cancellation: cancellation) }
              catch SendError.stopped { return false }
              catch {
                _ = try pauseSendJob(config: config, id: job.id, reason: .compression)
                finished = true; complete = false
              }
            case let .upload(transfer):
              try enqueueTransfer(transfer, settings: settings, cancellation: cancellation)
              finished = true; complete = false
            case .confirm: retryWhenForeground(); finished = true; complete = false
            case .sent, .failed: finished = true
            case .continue: break
            case let .paused(failure):
              if failure.disposition == .retry { retryWhenForeground() }
              finished = true; complete = false
            }
          }
        } catch SendError.stopped { return false }
        catch {
          _ = try? pauseSendJob(config: config, id: job.id, reason: .storage)
          complete = false
        }
      }
      if !complete { schedule() }
      return complete
    } catch { return false }
  }
  private func enqueueTransfer(_ transfer: SendUpload, settings: SendWorkerConfig, cancellation: SendCancellation) throws {
    guard let url = URL(string: transfer.url), url.scheme == "https" else { throw SendError.invalidCheckpoint }
    let id = transfer.id
    let path = transfer.file
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
    let task = session.uploadTask(with: request, fromFile: payload)
    task.taskDescription = description
    task.resume()
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
    guard identifier == Self.sessionIdentifier else { completion(); return }
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
