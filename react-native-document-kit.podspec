require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-document-kit"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "15.0" }
  s.source       = { :git => package["repository"]["url"], :tag => "v#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.frameworks   = "AVFoundation", "AVKit", "CoreMedia", "CoreMotion", "CoreTelephony", "ImageIO", "Network", "PhotosUI", "QuickLook", "UniformTypeIdentifiers", "UserNotifications"

  install_modules_dependencies(s)
end
