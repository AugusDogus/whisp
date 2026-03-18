import ExpoModulesCore
import UIKit

public final class UploadthingBackgroundAppDelegateSubscriber:
  ExpoAppDelegateSubscriber
{
  public func subscriberDidRegister() {
    _ = BackgroundUploadManager.shared
  }

  public func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    BackgroundUploadManager.shared.registerBackgroundCompletionHandler(
      identifier: identifier,
      completionHandler: completionHandler
    )
  }
}
