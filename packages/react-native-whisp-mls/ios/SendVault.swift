import Foundation
import Security

/// Same unlock policy as the foreground MLS key. A locked phone pauses preparation.
enum SendVault {
  private static let service = "whisp.native.send.v1"
  static func set(_ value: String?) throws {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: "active"]
    guard let value else {
      let result = SecItemDelete(query as CFDictionary)
      guard result == errSecSuccess || result == errSecItemNotFound else { throw SendError.vault }
      return
    }
    let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
    let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updated == errSecItemNotFound {
      guard SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw SendError.vault }
    } else if updated != errSecSuccess { throw SendError.vault }
  }
  static func get() throws -> String? {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: "active",
      kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
    var item: CFTypeRef?
    let result = SecItemCopyMatching(query as CFDictionary, &item)
    if result == errSecItemNotFound { return nil }
    guard result == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else { throw SendError.vault }
    return value
  }
}
enum SendError: LocalizedError {
  case vault, invalidCheckpoint, compression, stopped, storage
  var errorDescription: String? {
    switch self {
    case .vault: return "Unlock Whisp and sign in to resume queued sends."
    case .invalidCheckpoint: return "The native send checkpoint could not be read. The queued whisp is preserved."
    case .compression: return "Media compression failed. The original capture remains queued."
    case .stopped: return "Sending paused. Open Whisp to resume."
    case .storage: return "The send could not be saved. Free device storage and retry."
    }
  }
}
final class SendCancellation {
  private let lock = NSLock()
  private var stopped = false
  func cancel() { lock.lock(); stopped = true; lock.unlock() }
  var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
}
