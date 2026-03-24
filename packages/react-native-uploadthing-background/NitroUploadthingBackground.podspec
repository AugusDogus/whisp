require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroUploadthingBackground"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/AugusDogus/whisp.git", :tag => s.version.to_s }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]

  load 'nitrogen/generated/ios/NitroUploadthingBackground+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  s.dependency 'ExpoModulesCore'
  install_modules_dependencies(s)

  # `UploadthingBackgroundAppDelegateSubscriber` subclasses Expo's generated
  # `EXBaseAppDelegateSubscriber`. Nitrogen's umbrella imports
  # `ExpoModulesCore-Swift.h` via `__has_include`, but that header only resolves
  # if this pod's HEADER_SEARCH_PATHS includes Expo's Swift compatibility header
  # output (same path Expo adds to the app target in ExpoModulesCore.podspec).
  # Without it, the umbrella skips the import and ObjC++ compilation of
  # `NitroUploadthingBackground-Swift.h` fails with "cannot find interface
  # declaration for EXBaseAppDelegateSubscriber".
  expo_swift_header = '"${PODS_CONFIGURATION_BUILD_DIR}/ExpoModulesCore/Swift Compatibility Header"'
  hash = s.to_hash
  current_config = hash["pod_target_xcconfig"] != nil ? hash["pod_target_xcconfig"].dup : {}
  current_headers = current_config["HEADER_SEARCH_PATHS"] != nil ? current_config["HEADER_SEARCH_PATHS"] : "$(inherited)"
  current_config["HEADER_SEARCH_PATHS"] = "#{current_headers} #{expo_swift_header}"
  s.pod_target_xcconfig = current_config
end
