# Fractal Android

Fractal Android 0.2.0 (`versionCode 2`) is the native Kotlin/Compose reader companion. It uses the scholarly interface, Saved/Recent and folders, persistent question/explanation history, annotations, ink and sticky notes. Native News and Topics screens include article source/translation split reading. Exact PDF text selection and available publication PDFs open in the reader; publisher links are explicit fallbacks when a PDF cannot be acquired. Discovery uses the Hub's suitable paper-figure/article-content image selection and cache, with text and reading actions retained when no usable image is available.

Download the [published 0.2.0 debug APK](https://github.com/iwantgobackhome/fractal/releases/download/v0.2.0/Fractal-0.2.0-android-debug.apk). It retains the 0.1.0 signing certificate. [Release notes](../../docs/releases/0.2.0.md) provide checksums and the actual CI verification scope.

Open `apps/android` in Android Studio with JDK 17 and SDK 35. The app requires Android 10 (API 29) or newer and targets API 35. Build the companion with `./gradlew :app:assembleDebug` (`gradlew.bat` on Windows); the APK is `app/build/outputs/apk/debug/app-debug.apk`. The `:inkdemo` application remains a tablet pen test; `:design` and `:ink` are reader libraries.

Pair with the desktop Hub using its QR code, then use a trusted LAN or Tailscale. The Hub provides AI and discovery services; cached PDFs and retained annotations/history remain available according to their local cache state. The emulator reaches a Hub on the host through `10.0.2.2`.

The release pipeline names the debug-signed distribution `Fractal-0.2.0-android-debug.apk`. It restores a stable debug keystore from an Actions secret, binds the build to that explicit temporary signing path, and verifies the public certificate SHA against the previous release before assembly and again on the APK. An update retains the same signing identity; local builds keep their default signing configuration when the CI path is absent. These checks verify APK manifest and signing, without implying emulator, physical-device or API 35 runtime certification. See [release builds](../../docs/RELEASING.md).

Optional library/demo checks: `./gradlew :ink:testDebugUnitTest :design:assembleDebug :inkdemo:assembleDebug`.
