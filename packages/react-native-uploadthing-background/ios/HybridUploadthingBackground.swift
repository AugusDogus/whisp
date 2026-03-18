import Foundation
import NitroModules

final class HybridUploadthingBackground: HybridUploadthingBackgroundSpec {
  private let manager = BackgroundUploadManager.shared

  var activeTaskCount: Double {
    Double(manager.activeTaskCount())
  }

  func enqueueUpload(
    request: BackgroundUploadRequest
  ) throws -> Promise<BackgroundUploadTask> {
    manager.enqueueUpload(request: request)
  }

  func getTask(
    taskId: String
  ) throws -> Promise<Variant_NullType_BackgroundUploadTask> {
    Promise.resolved(withResult: manager.task(taskId: taskId))
  }

  func listTasks() throws -> Promise<[BackgroundUploadTask]> {
    Promise.resolved(withResult: manager.listTasks())
  }

  func cancelUpload(taskId: String) throws -> Promise<Void> {
    manager.cancelUpload(taskId: taskId)
  }

  func removeTask(taskId: String) throws -> Promise<Void> {
    manager.removeTask(taskId: taskId)
  }
}
