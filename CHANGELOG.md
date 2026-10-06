# Changelog

## 0.4.0 — 2026-10-06

Translation: vector figures are kept whole with their labels, bold abstracts and two-line titles stay together, accents and inline math are preserved, exported PDFs fit each original page on one sheet, and the Android translated view shows figures, tables and equations. Questions are conversations with follow-up context, quotes attach to one question, the input is reduced to a model picker, the answer language moved to Settings, and the desktop side panel can be resized. Android versionCode 9. See [release notes](docs/releases/0.4.0.md).

## 0.3.1 — 2026-10-06

The "News Papers" wordmark stays on one line in the desktop sidebar. Android versionCode 8. See [release notes](docs/releases/0.3.1.md).

## 0.3.0 — 2026-10-06

Fractal is renamed News Papers (repository `iwantgobackhome/news-papers`). Desktop data is copied to the new location on first start. Android is a new app (`app.newspapers.reader`), with a transitional Fractal-named APK for 0.2.x updaters. New N·P icon generated from one source, a macOS grid app icon and a monochrome menu-bar template. Settings show the version and a Check for updates button. Android versionCode 7. See [release notes](docs/releases/0.3.0.md).

## 0.2.4 — 2026-10-06

Codex and Claude CLIs are detected on macOS and Linux when Fractal starts from Finder, the Dock or a desktop launcher. The in-app installer supports macOS and Linux, and its Windows Codex (npm) and Claude (from PowerShell 7) installs are fixed. Failed installs show the installer output. A CI workflow installs and detects both CLIs on Linux, macOS and Windows. Android versionCode 6. See [release notes](docs/releases/0.2.4.md).

## 0.2.3 — 2026-10-05

Android highlights and notes whose selection ended inside a word are shown again; rows saved by 0.2.2 are repaired on Android and sync to the desktop. Unsigned macOS builds now announce new releases and open the download page. Android versionCode 5. See [release notes](docs/releases/0.2.3.md).

## 0.2.2 — 2026-10-04

Android: character-level long-press selection that follows visual lines (including inline math), tap elsewhere to clear, answer markers in the page margin that reopen minimized answers, a working fine pen-width slider with a size readout, tool-name tooltips on stylus hover or long press, and desktop-added papers that open in the reader after sync. Desktop: the answer popup model list stays open during translation. Android versionCode 4. See [release notes](docs/releases/0.2.2.md).

## 0.2.1 — 2026-10-02

In-app updates for Windows NSIS, Linux AppImage/deb and the Android APK (macOS stays DMG-only). Reliable pairing and batched sync for large ink histories. Movable, collapsible answer popups for questions and explanations on desktop and Android. On Android: no text-selection mode (long press then drag selects, the pen inks), precise column-aware selection, a circular live eraser and Explain chips on detected figures, tables and equations. On both platforms: live region rectangles and tap-to-delete highlights. Android versionCode 3. See [release notes](docs/releases/0.2.1.md).

## 0.2.0 — 2026-10-01

Scholarly desktop and native Android interfaces; persistent research history and annotations; sticky notes; Saved/Recent and nested folders; native News/Topics and split article reading; exact text selection; in-app publication PDF acquisition and cached reading. Discovery tries genuine captioned paper figures or news content images before suitable source thumbnails, caches verified images, and retains text when no usable image is available. Cross-platform packaging now targets Windows x64 NSIS, Linux x64 AppImage/deb, separate macOS arm64/x64 DMGs and a stable debug-signed Android APK (versionCode 2).

Published [0.2.0 downloads](https://github.com/iwantgobackhome/fractal/releases/tag/v0.2.0) include all six distributions and checksums. The [tagged native CI run](https://github.com/iwantgobackhome/fractal/actions/runs/36845792076) passed all five platform jobs, bundled desktop Hub/PTY startup and APK identity/signature checks; downloaded payloads and source/resource evidence were independently reviewed before publication. See [release notes](docs/releases/0.2.0.md) for signing qualifications and verification limits, and [release builds](docs/RELEASING.md) for the build process.

## 0.1.0

Existing public release with Windows and Android downloads. Preserved as published; 0.2.0 does not replace its tag or assets.
