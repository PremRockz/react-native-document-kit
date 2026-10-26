package com.documentkit

import androidx.core.content.FileProvider

/**
 * Own subclass so the manifest entry cannot clash with another library's
 * FileProvider declaration (the manifest merger keys providers by class name).
 */
class DocumentKitFileProvider : FileProvider()
