import Foundation

// Payload-free wakeup. Reconcile the configured account's durable jobs in JS.
enum WhispSendEvents {
  static let changed = Notification.Name("WhispSendStatusChanged")
  static func notify() { NotificationCenter.default.post(name: changed, object: nil) }
}
