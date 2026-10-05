#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/whisp-send-tests.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
platform_dir="$(xcode-select -p)/Platforms/MacOSX.platform/Developer"

xcrun swiftc -swift-version 5 \
  -F "$platform_dir/Library/Frameworks" \
  -I "$platform_dir/usr/lib" -L "$platform_dir/usr/lib" \
  -lXCTestSwiftSupport \
  -Xlinker -rpath -Xlinker "$platform_dir/Library/Frameworks" \
  -Xlinker -rpath -Xlinker "$platform_dir/Library/PrivateFrameworks" \
  -Xlinker -rpath -Xlinker "$platform_dir/usr/lib" \
  ios/SendTaskCompletion.swift tests/SendTaskCompletionTests.swift \
  -o "$test_dir/completion-tests"
"$test_dir/completion-tests"
