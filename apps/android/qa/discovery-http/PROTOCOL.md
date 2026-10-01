# Android discovery native HTTP protocol

This opt-in harness runs the accepted Hub API, SQLite storage, feed service, PDF extraction, article extraction, quick translation and synchronization routes. Only outbound scholarly/news/translation provider boundaries are controlled. Android screens use real HTTP responses and their normal Room caches; the production APK contains no harness content. The metadata for Attention Is All You Need, LoRA and Scikit-learn is reported publication metadata; abstracts are explicitly labeled QA paraphrases. Related edges, the QA news article and translation responses are controlled test content, not claims about actual citation graphs, current events or translation quality.

All runtime files, device credentials, downloaded PDF bytes and generated bundle are ignored. Never print `runtime/D-private.json`, commit runtime files, reset an existing profile, or reuse another owner's Hub. The isolated identity is `D-stage4-isolated`. This helper does not operate E's retained native bridge or emulator5560.

From the Android worktree root, with Node22+ and the accepted desktop dependency directory available:

```powershell
node apps/android/qa/discovery-http/build.mjs
```

`build.mjs` resolves dependencies from `../fractal-desktop/node_modules` by default; `QA_NODE_MODULES` can point to an existing compatible dependency tree. Before launch verify loopback ports6274 and6275 are free. Start `node.exe apps/android/qa/discovery-http/server.bundle.mjs` using `Start-Process -WindowStyle Hidden`, an exact worktree working directory and helper-local stdout/stderr paths. Record the returned PID and `Win32_Process` executable, command line and creation time in ignored `runtime/launch-identity.json`. Startup creates a fresh private profile beneath `runtime/http-*`; `runtime/server-identity.json` records its dynamically assigned internal API port and two proxy/control ports. Verify all three listener PIDs against that recorded process before use. Do not display credentials.

For an intentional restart of that exact running helper, `restart.ps1` verifies executable/start/command/listener ownership and profile containment, requests graceful close, verifies exit and closed ports, builds the bundle, and resumes only that same owned profile. `FRACTAL_D_QA_RESUME` is not a general profile migration mechanism. Push the regenerated private connection file after a restart.

```powershell
$adbPath = 'C:/Users/Home/AppData/Local/Android/Sdk/platform-tools/adb.exe'
& $adbPath -s emulator-5554 reverse tcp:6274 tcp:6274
& $adbPath -s emulator-5554 reverse tcp:6275 tcp:6275
& $adbPath -s emulator-5554 push apps/android/qa/discovery-http/runtime/D-private.json /data/local/tmp/fractal-D-stage4-private.json
```

The control endpoint is unauthenticated and restricted to loopback6275 in this disposable harness. `POST /D/mode` accepts `offline`, `textUnavailable`, `articleUnavailable`, `dropTopic` booleans and `provider` equal to `ready`, `429` or `timeout`. These controls cause actual HTTP503s, one lost topic POST response after real admission, provider429 with Retry-After, or actual abort-driven timeouts. Provider transitions age only this helper's related-provider cache to exercise production stale fallback. `GET /D/state` returns route/method/byte observations and owned data without authorization headers or device tokens.

`DiscoveryNativeTest` is opt-in and requires the private file. It verifies the isolated Hub ID, disables automatic download, and operates ordinary `MainActivity`, its actual Compose semantics/windows, and actual window-dispatched finger/stylus events. It never substitutes a Compose test owner or clears the app database. The dedicated text retry PDF has a distinct SHA; it cannot evict the accepted geometry fixture's cache. Older D-only input fixture catalog entries are explicitly admitted with their unchanged PDF bytes so their retained annotations can sync to this fresh QA Hub. The public Attention PDF is downloaded outside the controlled provider boundary and verified byte-for-byte before and after stable-key association.

Representative invocation, after a successful app/test APK build and scoped5554 installation:

```powershell
& $adbPath -s emulator-5554 shell am instrument -w -e class 'app.fractal.reader.DiscoveryNativeTest#liveNavigationMetadataSaveTopicsNewsOfflineAndReconnect' app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner
./apps/android/qa/stage4-capture.ps1 -Profile phone360-portrait
```

Check JUnit `OK` and failure details, rather than adb's process exit code alone. Capture profiles change only the owned emulator's size, density, font scale and the isolated app's language/theme. No `pm clear`, global adb restart, peer-device operation or user-library cleanup is permitted. A process-cold offline test sets the helper offline before starting a new instrumentation/application process and skips all initial refreshes.

For final graceful shutdown, verify the exact recorded PID/executable/command/creation time and all three listener owners again, create only this helper's `runtime/stop` file, await exit, and confirm all owned ports closed. Preserve a token-free copy of `runtime/final-state.json` and public identity evidence. If ownership changed or verification fails, stop and arrange an explicit coordinator handoff. Restore the owned emulator's size/density/font settings and close emulator5554 only after verifying its launcher/qemu executable, start and command/console identity; leave emulator5560 and the global adb server untouched.
