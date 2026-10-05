import Foundation

/// Expiration and worker completion race. Only one may finish the OS task;
/// neither may wait for the worker to return from synchronous native I/O.
final class SendTaskCompletion {
  private let lock = NSLock()
  private var completion: ((Bool) -> Void)?

  init(_ completion: @escaping (Bool) -> Void) {
    self.completion = completion
  }

  func finish(success: Bool) {
    lock.lock()
    let callback = completion
    completion = nil
    lock.unlock()
    callback?(success)
  }
}
