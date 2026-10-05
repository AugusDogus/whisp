import Foundation
import XCTest

// Run with bun run test:ios-lifecycle on a Mac with Xcode installed.
// No iOS device or generated Rust bindings are required.
final class SendTaskCompletionTests: XCTestCase {
  @objc func testExpirationFinishesBeforeWorkerReturns() {
    var results: [Bool] = []
    let completion = SendTaskCompletion { results.append($0) }

    completion.finish(success: false)
    XCTAssertEqual(results, [false])

    // Returning after expiration must not complete the OS task a second time.
    completion.finish(success: true)
    XCTAssertEqual(results, [false])
  }

  @objc func testWorkerCompletionBeforeExpiration() {
    var results: [Bool] = []
    let completion = SendTaskCompletion { results.append($0) }

    completion.finish(success: true)
    completion.finish(success: false)
    XCTAssertEqual(results, [true])
  }

  @objc func testConcurrentExpirationAndCompletionFinishOnce() {
    let lock = NSLock()
    var count = 0
    let completion = SendTaskCompletion { _ in
      lock.lock()
      count += 1
      lock.unlock()
    }

    DispatchQueue.concurrentPerform(iterations: 100) { index in
      completion.finish(success: index.isMultiple(of: 2))
    }
    XCTAssertEqual(count, 1)
  }
}

@main
enum SendTaskCompletionTestRunner {
  static func main() {
    let suite = SendTaskCompletionTests.defaultTestSuite
    suite.run()
    guard let run = suite.testRun, run.executionCount == 3, run.hasSucceeded else {
      exit(1)
    }
  }
}
