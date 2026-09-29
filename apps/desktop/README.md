# Desktop app

`npm run desktop` builds and opens the Electron shell. Closing or minimizing its window hides it in the tray while the embedded hub keeps running. The tray offers Open, Pairing, and Quit. `electron . --headless` starts the embedded hub without a window. `npm run desktop:dist` builds the Windows NSIS installer; macOS DMG configuration is included for a macOS build host.
