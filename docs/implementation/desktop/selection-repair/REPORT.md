# Desktop original word-selection repair

The actual original PDF reader expanded a pointer-selected word or partial word into its entire text run at pointer-up. The repair preserves native character precision for backend `granularity: run` geometry, while retaining grapheme/surrogate safety and known glyph-advance ligature boundaries. Coarse backend offsets remain coarse: unsupported precise `layoutRange` is omitted, and the exact substring keeps current-PDF identity and measured rendered-page geometry.

## Reproduction and root cause

Pre-fix source is retained checkout `2632f91d2f17955f75d2857078f319d7ab99ea19`, whose desktop production source matches accepted `08af7b3`. The representative academic PDF is [Attention Is All You Need](https://arxiv.org/abs/1706.03762), SHA256 `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`; its original downloaded bytes remain ignored at `dist/qa-word-selection-input/attention-1706.03762.pdf` and are excluded from release artifacts.

On physical page 1, the dense abstract run is `The dominant sequence transduction models are based on complex recurrent or`, authoritative offsets `[647,722)`, granularity `run`, legal boundaries only `[647,722]`, issue `run_boundary_fallback`. Real browser and Electron mouse drags selected `dominant` at local `[4,12)` and backward `ominan` at `[5,11)` before pointer-up. Capture passed coarse geometry boundaries through `legalOffset` and `selection.setBaseAndExtent`, expanding both to local `[0,75)`. Native DOM text, Ctrl+C, menu Copy, saved/reopened highlight and question quote all widened to the full run. [Before evidence](before.json) records offsets, direction, metadata, PDF.js scale transforms, geometry and strings; [browser failure](before-browser-word.png) and [Electron failure](before-electron-word.png) show the actual reader.

## Repair and focused checks

`native-selection.ts` separates native text/known glyph boundaries from backend range legality; avoids resetting an unchanged native selection; clears stale metadata; avoids re-appending already ordered text nodes when asynchronous layout arrives; and validates fresh unique runs, physical page and original legal endpoints before declaring precise offsets. The existing loaded-PDF hash check remains in `App.getTextLayout`. `PdfPane` invalidates obsolete asynchronous captures on new drags/unmounts, cancels a prior completion frame, and freezes actual pointer-up coordinates so subsequent hover cannot move the released endpoint; pointer cancellation retains the last valid coordinate.

- UI: 29 tests in 10 files and typechecking pass, including the new long coarse-run regression and retained grapheme/ligature cases. Full desktop production build passes; existing SQLite/Vite warnings remain.
- Actual browser and Electron: forward word/backward partial-word DOM, Ctrl+C and menu Copy remain `dominant`/`ominan`; saved/reopened highlights paint only those measured glyphs; reopened excerpt and durable question draft quote agree. Coarse selections have current PDF hash/rendered frame and no unsupported `layoutRange`.
- Focused browser risks: zoom, movement immediately after release, neighboring column isolation, forward/backward proportional glyph selection, cropped 90-degree page and 30-degree text transform, combining grapheme, surrogate pair, real `fi` glyph versus ordinary `f`/`i`, cross-page text/clipboard/page regions, and translated character copy/quote with only translated provenance. [After evidence](after.json) and [run log](after.log) contain results. No JS-created selection is used as input: `Range` objects only measure rendered glyph coordinates; `removeAllRanges` only clears previous selections.
- Existing annotation/history storage, legacy bytes, extraction precision and backend boundaries are not rewritten; no shared/Hub/Android production files, generated tokens or request14 mapping are changed.

## Accepted source and fresh Windows package

Root reviewed and integrated clean repair commit **`0efa96c7575435d9ce408c4dcc2ce427134e9141`**, then explicitly declared that exact commit as accepted package source; no broader source merge was needed. Before/after reader evidence was collected on the corresponding working tree before committing the repair; the packaged evidence records the accepted commit itself. The subsequent report/tooling/evidence commit changes no shipped production source.

`npm run desktop:build` followed by `npx electron-builder --win nsis --config.directories.output=dist/installer-selection-repair` built a new actual Windows x64 app and NSIS installer. [Build log](package-build.log), [packaged native evidence](packaged.json), [run log](packaged.log), [word](packaged-electron-word.png), [backward partial word](packaged-electron-partial-backward.png), and [question quote](packaged-electron-quote.png) verify the actual `app.isPackaged` reader from this directory. It keeps `dominant`/`ominan` through mouse release, native Electron clipboard and menu copy; saves and reopens the bounded word highlight/excerpt; and retains the exact durable quote with current PDF/frame and omitted unsupported precise offsets. The isolated app was not installed over the user's application/data.

| Actual artifact (absolute path) | Bytes | SHA256 |
| --- | ---: | --- |
| `C:/Users/Home/orca/workspaces/fractal/fractal-desktop/dist/installer-selection-repair/win-unpacked/Fractal.exe` | 246032896 | `053eb6d3931cee208b54154cb0840fc22f4ffe9a47d6663f7635b189e8fbd9c1` |
| `C:/Users/Home/orca/workspaces/fractal/fractal-desktop/dist/installer-selection-repair/Fractal Setup 0.1.0.exe` | 117588001 | `63ee8767cf28671a1d140dada62502b51ebddfb9f2e515c7cc020714cb52b986` |
| `C:/Users/Home/orca/workspaces/fractal/fractal-desktop/dist/installer-selection-repair/win-unpacked/resources/app.asar` | 13186982 | `c0f5e32e378d15dd92e7e84ba8d344e1745991a85a854503cfe0cf671a341ed1` |

[Native icons](native-icons.json) proves executable/NSIS RT_GROUP_ICON/RT_ICON bytes still match the accepted branch ICO at 16/24/32/48/64/128/256 px; packaged window/tray assets are 256/32 px. [Archive/resource proof](package-resources.json) compares shipped main/preload/Hub/UI bundles and branch icon assets byte-for-byte to the current accepted-source build, excludes verification tools/reports/PDF inputs, and proves owned main-process/listener exit while preserving the isolated profile. The old `08af7b3` installer remains historical and is **not** this fixed delivery.

Root integrates and E performs independent focused accepted-source/package verification; that external review is not claimed as executed by C. No user PDF/page/word was supplied during C's run; the public original academic PDF provides the actual coarse-run reproduction. No OCR, scanned-text precision, installation, macOS or unrelated Android/news/library matrix claim is made.

## Resource disposition

Each run uses fresh isolated Hub data, browser context and Electron profile. Browser dependents close before seed-Hub shutdown; Electron is closed through its own Playwright application handle after recording exact main-process executable, PID, command, creation time, listener and profile. Owned process exit is verified. Temporary profiles, public PDF inputs and evidence remain available for independent E review; no installation, user profile/data change, peer terminal/process stop or unrelated matrix is performed.
