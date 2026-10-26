package com.documentkit

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ViewManager
import com.documentkit.camera.DocumentKitCameraModule
import com.documentkit.camera.DocumentKitCameraViewManager

class DocumentKitPackage : BaseReactPackage() {
  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<in Nothing, in Nothing>> = listOf(DocumentKitCameraViewManager())

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    when (name) {
      DocumentKitPermissionsModule.NAME -> DocumentKitPermissionsModule(reactContext)
      DocumentKitMediaPickerModule.NAME -> DocumentKitMediaPickerModule(reactContext)
      DocumentKitDownloaderModule.NAME -> DocumentKitDownloaderModule(reactContext)
      DocumentKitPreviewModule.NAME -> DocumentKitPreviewModule(reactContext)
      DocumentKitNetworkModule.NAME -> DocumentKitNetworkModule(reactContext)
      DocumentKitCameraModule.NAME -> DocumentKitCameraModule(reactContext)
      else -> null
    }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    listOf(
      DocumentKitPermissionsModule.NAME to DocumentKitPermissionsModule::class.java.name,
      DocumentKitMediaPickerModule.NAME to DocumentKitMediaPickerModule::class.java.name,
      DocumentKitDownloaderModule.NAME to DocumentKitDownloaderModule::class.java.name,
      DocumentKitPreviewModule.NAME to DocumentKitPreviewModule::class.java.name,
      DocumentKitNetworkModule.NAME to DocumentKitNetworkModule::class.java.name,
      DocumentKitCameraModule.NAME to DocumentKitCameraModule::class.java.name,
    ).associate { (name, className) ->
      name to ReactModuleInfo(
        name,
        className,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        true, // isTurboModule
      )
    }
  }
}
