# Android translated source crops

Implemented on `iwantgobackhome/android-translated-figures`, based on main commit `8665b906cdcd90a2d7d7875b40641da11915d399`. Only `apps/android/**` changed.

`translatedBlocks()` retains figure, table, equation, and unsupported blocks with usable normalized regions, in block order. It preserves every region, including regions on different physical pages, and rejects non-finite or empty crop rectangles. Media stays available when text translations are absent; prose keeps its existing completed-translation gate and source-text fallback. Unit coverage verifies ordering, physical page numbers, coordinates, multiple regions, translated captions, untranslated prose fallback, invalid rectangles, and media without translations.

The translated list renders each media region from the original PDF via `PdfPages.cropBitmap()`. It renders only the crop with a PDF matrix at the pane's physical pixel width, off the main thread, retaining source aspect ratio and limiting extreme bitmap dimensions. Crops share the existing 80 MiB byte-bounded cache; synchronization serializes render/close operations. Cached images are never manually recycled while Compose or another consumer can still hold them; failed private renders are recycled immediately, and evicted images become eligible for Android memory reclamation once consumers release them. Paper backgrounds remain white inside source crops, including dark and sepia modes.

Page labels/dividers appear at page boundaries rather than under every block. Headings use title typography; captions use smaller body typography and remain in reading order. Selection and copying remain native. Copying a selected excerpt reveals the existing quote action, and each text block also exposes its whole-block quote as an accessibility custom action. Existing instrumented whole-block quote interactions were updated to use that semantic action. Figure tap-to-explain was optional and was not added.

## Validation

Both the untouched main baseline and final tree pass:

```sh
cd apps/android
ANDROID_HOME=/Users/dowankim/Library/Android/sdk \
JAVA_HOME=/Users/dowankim/Library/Java/JavaVirtualMachines/jdk-17.0.20.1+1/Contents/Home \
bash ./gradlew :data:testDebugUnitTest :app:testDebugUnitTest :app:assembleDebug
```

The final data unit suite reports 18 tests and the app unit suite reports 16 tests, with zero failures. `:app:assembleDebugAndroidTest` also passes. No pre-existing unit/build failures were found. The initial environment-only attempt lacked `ANDROID_HOME`; configuring the installed SDK fixed it. Build logs are [baseline-build.txt](baseline-build.txt) and [build.txt](build.txt).

AVDs were available. The existing `emulator-5554` was paired, so its fixture guard rejected instrumentation before modifying fixture data; it was not cleared or unpaired. The separate `Galaxy_23_API_34` AVD ran as `emulator-5556` with snapshot saving disabled. After boot/unlock and disabling that disposable AVD's repeatedly crashing Bluetooth service, `ReaderStageTest#translatedSourceCropsAppearWithCaptionInReadingOrder` passed in Light, Dark, and Sepia, one test per theme. It checks visible figure/table/equation images, positive crop dimensions, figure → translated caption → table → equation ordering, and successful whole-block translated quote routing. Logs: [light-test.txt](light-test.txt), [dark-test.txt](dark-test.txt), [sepia-test.txt](sepia-test.txt).

The temporary Bluetooth disable was reversed and the spawned AVD was stopped after validation.

Screenshots were taken by instrumented UiAutomation and pulled with adb: [light.png](light.png), [dark.png](dark.png), [sepia.png](sepia.png). These use the checked-in text-layout PDF with synthetic figure/table/equation block metadata; the image contents are original PDF text crops, demonstrating the crop pipeline and placement rather than a particular publication's illustrations. Screenshots were inspected to confirm readable crops and that no system dialog obscures the view. This validation does not claim a full instrumented-suite run or physical-device verification.

Nothing remains for the requested implementation; no push, tag, or release was performed.
