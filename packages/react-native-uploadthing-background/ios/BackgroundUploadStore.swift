import Foundation

private enum StoredBackgroundUploadTaskStatus: String, Codable {
  case queued
  case uploading
  case completed
  case failed
  case cancelled

  var publicStatus: BackgroundUploadTaskStatus {
    switch self {
    case .queued:
      return .queued
    case .uploading:
      return .uploading
    case .completed:
      return .completed
    case .failed:
      return .failed
    case .cancelled:
      return .cancelled
    }
  }
}

private struct StoredBackgroundUploadHeader: Codable {
  let key: String
  let value: String
}

struct StoredBackgroundUploadTaskRecord: Codable {
  let taskId: String
  var status: StoredBackgroundUploadTaskStatus
  let url: String
  let fileUri: String
  let fileName: String
  let mimeType: String
  var bytesSent: Double
  var totalBytes: Double
  var responseCode: Double?
  var responseBody: String?
  var errorMessage: String?
  let createdAt: Double
  var updatedAt: Double
  let method: String
  let headers: [StoredBackgroundUploadHeader]
  var sessionTaskIdentifier: Int?
  var multipartFilePath: String?
  let notificationTitle: String?
  let notificationBody: String?

  init(
    request: BackgroundUploadRequest,
    totalBytes: Double,
    sessionTaskIdentifier: Int?,
    multipartFilePath: String?
  ) {
    let now = Date().timeIntervalSince1970 * 1000

    taskId = request.taskId
    status = .queued
    url = request.url
    fileUri = request.fileUri
    fileName = request.fileName
    mimeType = request.mimeType
    bytesSent = 0
    self.totalBytes = totalBytes
    responseCode = nil
    responseBody = nil
    errorMessage = nil
    createdAt = now
    updatedAt = now
    method = request.method ?? "PUT"
    headers = (request.headers ?? []).map {
      StoredBackgroundUploadHeader(key: $0.key, value: $0.value)
    }
    self.sessionTaskIdentifier = sessionTaskIdentifier
    self.multipartFilePath = multipartFilePath
    notificationTitle = request.notificationTitle
    notificationBody = request.notificationBody
  }

  func asTask() -> BackgroundUploadTask {
    BackgroundUploadTask(
      taskId: taskId,
      status: status.publicStatus,
      url: url,
      fileUri: fileUri,
      fileName: fileName,
      mimeType: mimeType,
      bytesSent: bytesSent,
      totalBytes: totalBytes,
      responseCode: responseCode,
      responseBody: responseBody,
      errorMessage: errorMessage,
      createdAt: createdAt,
      updatedAt: updatedAt
    )
  }
}

final class BackgroundUploadStore {
  static let shared = BackgroundUploadStore()

  private let queue = DispatchQueue(label: "uploadthing.background.store")
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()
  private var cachedRecords: [String: StoredBackgroundUploadTaskRecord]?

  private init() {}

  func activeTaskCount() -> Int {
    queue.sync {
      recordsLocked().values.filter {
        $0.status == .queued || $0.status == .uploading
      }.count
    }
  }

  func listTasks() -> [BackgroundUploadTask] {
    queue.sync {
      recordsLocked()
        .values
        .sorted(by: { $0.createdAt < $1.createdAt })
        .map { $0.asTask() }
    }
  }

  func task(taskId: String) -> BackgroundUploadTask? {
    queue.sync {
      recordsLocked()[taskId]?.asTask()
    }
  }

  func record(taskId: String) -> StoredBackgroundUploadTaskRecord? {
    queue.sync {
      recordsLocked()[taskId]
    }
  }

  func record(forSessionTaskIdentifier taskIdentifier: Int) -> StoredBackgroundUploadTaskRecord? {
    queue.sync {
      recordsLocked().values.first(where: { $0.sessionTaskIdentifier == taskIdentifier })
    }
  }

  func upsert(_ record: StoredBackgroundUploadTaskRecord) {
    queue.sync {
      var records = recordsLocked()
      records[record.taskId] = record
      persistLocked(records)
    }
  }

  @discardableResult
  func update(
    taskId: String,
    mutate: (inout StoredBackgroundUploadTaskRecord) -> Void
  ) -> StoredBackgroundUploadTaskRecord? {
    queue.sync {
      var records = recordsLocked()
      guard var record = records[taskId] else {
        return nil
      }

      mutate(&record)
      record.updatedAt = Date().timeIntervalSince1970 * 1000
      records[taskId] = record
      persistLocked(records)
      return record
    }
  }

  @discardableResult
  func remove(taskId: String) -> StoredBackgroundUploadTaskRecord? {
    queue.sync {
      var records = recordsLocked()
      let removed = records.removeValue(forKey: taskId)
      persistLocked(records)
      return removed
    }
  }

  private func recordsLocked() -> [String: StoredBackgroundUploadTaskRecord] {
    if let cachedRecords {
      return cachedRecords
    }

    do {
      let data = try Data(contentsOf: storageURL())
      let decoded = try decoder.decode(
        [String: StoredBackgroundUploadTaskRecord].self,
        from: data
      )
      cachedRecords = decoded
      return decoded
    } catch {
      cachedRecords = [:]
      return [:]
    }
  }

  private func persistLocked(_ records: [String: StoredBackgroundUploadTaskRecord]) {
    cachedRecords = records

    do {
      let data = try encoder.encode(records)
      let url = try storageURL()
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(),
        withIntermediateDirectories: true,
        attributes: nil
      )
      try data.write(to: url, options: .atomic)
    } catch {
      NSLog(
        "[UploadthingBackground] Failed to persist background upload store: \(error.localizedDescription)"
      )
    }
  }

  private func storageURL() throws -> URL {
    let directory = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )

    return directory
      .appendingPathComponent("uploadthing-background", isDirectory: true)
      .appendingPathComponent("tasks.json", isDirectory: false)
  }
}
