import ExpoModulesCore
import UIKit

public final class WhispSendModule: Module {
  private var statusObserver: NSObjectProtocol?
  // Concurrent so an enqueue waiting for the device lease cannot block a
  // configure call made by its holder. Never block Expo's shared async queue.
  private let operations = DispatchQueue(label: "whisp.send.module", qos: .utility, attributes: .concurrent)
  private let configurations = DispatchQueue(label: "whisp.send.configuration", qos: .utility)
  public func definition() -> ModuleDefinition {
    Name("WhispSend")
    Constant("statusEventsSupported") { true }
    Events("onSendStatusChanged")
    OnStartObserving {
      guard statusObserver == nil else { return }
      statusObserver = NotificationCenter.default.addObserver(forName: WhispSendEvents.changed, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("onSendStatusChanged", [:])
      }
    }
    OnStopObserving { removeStatusObserver() }
    OnDestroy { removeStatusObserver() }
    AsyncFunction("configure") { (config: String?) in try WhispSendManager.shared.configure(config) }.runOnQueue(configurations)
    AsyncFunction("enqueue") { (input: String) -> String in
      guard let config = try SendVault.get() else { throw SendError.vault }
      let id = try enqueueSendJob(config: config, input: input)
      WhispSendManager.shared.resume()
      WhispSendEvents.notify()
      return id
    }.runOnQueue(operations)
    AsyncFunction("list") { () -> String in
      guard let config = try SendVault.get() else { return "[]" }
      return try listSendJobs(config: config)
    }.runOnQueue(operations)
    AsyncFunction("acknowledge") { (id: String) in
      if let config = try SendVault.get() { try acknowledgeSendJob(config: config, id: id) }
    }.runOnQueue(operations)
    AsyncFunction("resume") { WhispSendManager.shared.resume(retryBlocked: true) }.runOnQueue(operations)
  }
  private func removeStatusObserver() {
    if let observer = statusObserver { NotificationCenter.default.removeObserver(observer) }
    statusObserver = nil
  }
}
public final class WhispSendAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    WhispSendManager.shared.register()
    WhispSendManager.shared.resume()
    return true
  }
  public func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
    WhispSendManager.shared.handleEvents(identifier, completion: completionHandler)
  }
}
