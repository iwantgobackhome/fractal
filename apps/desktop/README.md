# Desktop app

`npm run desktop` builds and opens the Electron shell. Closing or minimizing its window hides it in the tray while the embedded hub keeps running. The tray offers Open, Pairing, and Quit. `electron . --headless` starts the embedded hub without a window. `npm run desktop:dist` builds the Windows NSIS installer; macOS DMG configuration is included for a macOS build host.

The reviewed branch master is copied to `assets/branch.svg`; `node apps/desktop/tools/generate-icons.mjs` regenerates Windows/window/tray exports without changing its paths. `FRACTAL_DESKTOP_PROFILE` optionally isolates Electron session/profile state for verification; `FRACTAL_DATA` and `PAPERREAD_DATA` must also be isolated before a test launch. See [desktop stage 1 verification](../../docs/implementation/desktop/stage1-report.md) for the actual product captures, flows and native icon observations.
