import Foundation
import NitroModules

enum BackgroundUploadManagerError: LocalizedError {
  case invalidFileURI(String)
  case invalidUploadURL(String)
  case missingMultipartStream

  var errorDescription: String? {
    switch self {
    case .invalidFileURI(let value):
      return "The file URI \"\(value)\" is not a readable local file."
    case .invalidUploadURL(let value):
      return "The upload URL \"\(value)\" is invalid."
    case .missingMultipartStream:
      return "Failed to create a writable multipart body stream."
    }
  }
}

final class BackgroundUploadManager: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
  static let shared = BackgroundUploadManager()
  static let sessionIdentifier =
    "\(Bundle.main.bundleIdentifier ?? "whisp").uploadthing.background"

  private let store = BackgroundUploadStore.shared
  private let queue = DispatchQueue(label: "uploadthing.background.manager")
  private var backgroundCompletionHandlers: [() -> Void] = []
  private var responseData: [Int: Data] = [:]

  private lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.background(
      withIdentifier: Self.sessionIdentifier
    )
    configuration.isDiscretionary = false
    configuration.sessionSendsLaunchEvents = true
    configuration.waitsForConnectivity = true
    configuration.timeoutIntervalForRequest = 60
    configuration.timeoutIntervalForResource = 60 * 60

    return URLSession(
      configuration: configuration,
      delegate: self,
      delegateQueue: nil
    )
  }()

  private override init() {
    super.init()
    _ = session
  }

  func activeTaskCount() -> Int {
    store.activeTaskCount()
  }

  func enqueueUpload(request: BackgroundUploadRequest) -> Promise<BackgroundUploadTask> {
    Promise.parallel { [self] in
      let uploadURL = try makeUploadURL(from: request.url)
      let sourceFileURL = try makeLocalFileURL(from: request.fileUri)
      let multipartBody = try createMultipartBody(
        request: request,
        sourceFileURL: sourceFileURL
      )

      var urlRequest = URLRequest(url: uploadURL)
      urlRequest.httpMethod = request.method ?? "PUT"
      for header in request.headers ?? [] {
        urlRequest.setValue(header.value, forHTTPHeaderField: header.key)
      }
      urlRequest.setValue(
        multipartBody.contentType,
        forHTTPHeaderField: "Content-Type"
      )
      urlRequest.setValue(
        String(Int64(multipartBody.totalBytes)),
        forHTTPHeaderField: "Content-Length"
      )

      let uploadTask = session.uploadTask(
        with: urlRequest,
        fromFile: multipartBody.fileURL
      )

      let record = StoredBackgroundUploadTaskRecord(
        request: request,
        totalBytes: multipartBody.totalBytes,
        sessionTaskIdentifier: uploadTask.taskIdentifier,
        multipartFilePath: multipartBody.fileURL.path
      )

      store.upsert(record)
      uploadTask.resume()

      _ = store.update(taskId: request.taskId) { record in
        record.status = .uploading
      }

      return store.task(taskId: request.taskId) ?? record.asTask()
    }
  }

  func task(taskId: String) -> Variant_NullType_BackgroundUploadTask {
    if let task = store.task(taskId: taskId) {
      return .second(task)
    }

    return .first(.null)
  }

  func listTasks() -> [BackgroundUploadTask] {
    store.listTasks()
  }

  func cancelUpload(taskId: String) -> Promise<Void> {
    Promise.async { [self] in
      let record = store.record(taskId: taskId)

      if let sessionTaskIdentifier = record?.sessionTaskIdentifier {
        let sessionTasks = await allSessionTasks()
        if let task = sessionTasks.first(where: { $0.taskIdentifier == sessionTaskIdentifier }) {
          task.cancel()
        }
      }

      _ = store.update(taskId: taskId) { record in
        record.status = .cancelled
        record.errorMessage = "The upload was cancelled."
      }
    }
  }

  func removeTask(taskId: String) -> Promise<Void> {
    Promise.parallel { [self] in
      let removed = store.remove(taskId: taskId)
      if let multipartFilePath = removed?.multipartFilePath {
        try? FileManager.default.removeItem(atPath: multipartFilePath)
      }
    }
  }

  func registerBackgroundCompletionHandler(
    identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    guard identifier == Self.sessionIdentifier else {
      completionHandler()
      return
    }

    queue.async {
      self.backgroundCompletionHandlers.append(completionHandler)
    }
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    queue.async {
      let handlers = self.backgroundCompletionHandlers
      self.backgroundCompletionHandlers.removeAll()

      DispatchQueue.main.async {
        handlers.forEach { $0() }
      }
    }
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive data: Data
  ) {
    queue.async {
      self.responseData[dataTask.taskIdentifier, default: Data()].append(data)
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didSendBodyData bytesSent: Int64,
    totalBytesSent: Int64,
    totalBytesExpectedToSend: Int64
  ) {
    guard let record = store.record(forSessionTaskIdentifier: task.taskIdentifier) else {
      return
    }

    _ = store.update(taskId: record.taskId) { record in
      record.status = .uploading
      record.bytesSent = Double(totalBytesSent)
      if totalBytesExpectedToSend > 0 {
        record.totalBytes = Double(totalBytesExpectedToSend)
      }
    }
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didCompleteWithError error: (any Error)?
  ) {
    guard let record = store.record(forSessionTaskIdentifier: task.taskIdentifier) else {
      return
    }

    let responseCode = (task.response as? HTTPURLResponse)?.statusCode
    let responseBody = queue.sync {
      let data = responseData.removeValue(forKey: task.taskIdentifier)
      return data.flatMap { String(data: $0, encoding: .utf8) }
    }

    _ = store.update(taskId: record.taskId) { record in
      record.bytesSent = max(record.bytesSent, record.totalBytes)
      record.responseCode = responseCode.map(Double.init)
      record.responseBody = responseBody

      if let nsError = error as NSError? {
        if nsError.code == NSURLErrorCancelled {
          record.status = .cancelled
        } else {
          record.status = .failed
        }
        record.errorMessage = nsError.localizedDescription
      } else if let responseCode, !(200..<300).contains(responseCode) {
        record.status = .failed
        record.errorMessage =
          responseBody ??
          HTTPURLResponse.localizedString(forStatusCode: responseCode)
      } else {
        record.status = .completed
        record.errorMessage = nil
      }
    }

    if let multipartFilePath = record.multipartFilePath {
      try? FileManager.default.removeItem(atPath: multipartFilePath)
    }
  }

  private func allSessionTasks() async -> [URLSessionTask] {
    await withCheckedContinuation { continuation in
      session.getAllTasks { tasks in
        continuation.resume(returning: tasks)
      }
    }
  }

  private func makeUploadURL(from value: String) throws -> URL {
    guard let url = URL(string: value) else {
      throw BackgroundUploadManagerError.invalidUploadURL(value)
    }
    return url
  }

  private func makeLocalFileURL(from value: String) throws -> URL {
    if let url = URL(string: value), url.isFileURL {
      if FileManager.default.fileExists(atPath: url.path) {
        return url
      }
    }

    let localURL = URL(fileURLWithPath: value)
    if FileManager.default.fileExists(atPath: localURL.path) {
      return localURL
    }

    throw BackgroundUploadManagerError.invalidFileURI(value)
  }

  private func createMultipartBody(
    request: BackgroundUploadRequest,
    sourceFileURL: URL
  ) throws -> (fileURL: URL, contentType: String, totalBytes: Double) {
    let boundary = "UploadthingBackground-\(UUID().uuidString)"
    let bodyURL = try makeMultipartBodyURL(taskId: request.taskId)
    let contentType = "multipart/form-data; boundary=\(boundary)"

    let escapedFileName = request.fileName.replacingOccurrences(
      of: "\"",
      with: "'"
    )
    let header = """
      --\(boundary)\r
      Content-Disposition: form-data; name=\"file\"; filename=\"\(escapedFileName)\"\r
      Content-Type: \(request.mimeType)\r
      \r
      """
      .replacingOccurrences(of: "\n", with: "\r\n")
    let footer = "\r\n--\(boundary)--\r\n"

    guard let outputStream = OutputStream(url: bodyURL, append: false) else {
      throw BackgroundUploadManagerError.missingMultipartStream
    }

    outputStream.open()
    defer {
      outputStream.close()
    }

    try write(data: Data(header.utf8), to: outputStream)

    let inputStream = InputStream(url: sourceFileURL)
    inputStream?.open()
    defer {
      inputStream?.close()
    }

    let bufferSize = 64 * 1024
    var buffer = [UInt8](repeating: 0, count: bufferSize)
    while let inputStream, inputStream.hasBytesAvailable {
      let bytesRead = inputStream.read(&buffer, maxLength: bufferSize)
      if bytesRead < 0, let error = inputStream.streamError {
        throw error
      }
      if bytesRead == 0 {
        break
      }

      try write(data: Data(buffer[0..<bytesRead]), to: outputStream)
    }

    try write(data: Data(footer.utf8), to: outputStream)

    let fileSize = try FileManager.default.attributesOfItem(
      atPath: sourceFileURL.path
    )[.size] as? NSNumber
    let totalBytes =
      Double(Data(header.utf8).count) +
      Double(fileSize?.int64Value ?? 0) +
      Double(Data(footer.utf8).count)

    return (bodyURL, contentType, totalBytes)
  }

  private func makeMultipartBodyURL(taskId: String) throws -> URL {
    let directory = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
      .appendingPathComponent("uploadthing-background", isDirectory: true)
      .appendingPathComponent("bodies", isDirectory: true)

    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: nil
    )

    return directory.appendingPathComponent("\(taskId).multipart")
  }

  private func write(data: Data, to outputStream: OutputStream) throws {
    try data.withUnsafeBytes { rawBuffer in
      guard let baseAddress = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
        return
      }

      var totalBytesWritten = 0
      while totalBytesWritten < data.count {
        let bytesWritten = outputStream.write(
          baseAddress.advanced(by: totalBytesWritten),
          maxLength: data.count - totalBytesWritten
        )

        if bytesWritten < 0, let error = outputStream.streamError {
          throw error
        }

        totalBytesWritten += bytesWritten
      }
    }
  }
}
