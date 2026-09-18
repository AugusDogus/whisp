import ExpoModulesCore
import UIKit

public final class WhispSendModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WhispSend")
    AsyncFunction("configure") { (config: String?) in try WhispSendManager.shared.configure(config) }
    AsyncFunction("enqueue") { (input: String) -> String in
      guard let config = try SendVault.get() else { throw SendError.vault }
      let id = try enqueueSendJob(config: config, input: input)
      WhispSendManager.shared.resume()
      return id
    }
    AsyncFunction("list") { () -> String in
      guard let config = try SendVault.get() else { return "[]" }
      return try listSendJobs(config: config)
    }
    AsyncFunction("acknowledge") { (id: String) in
      if let config = try SendVault.get() { try acknowledgeSendJob(config: config, id: id) }
    }
    AsyncFunction("resume") { WhispSendManager.shared.resume() }
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
