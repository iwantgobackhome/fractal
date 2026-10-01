param([string]$Profile = 'all')
$ErrorActionPreference = 'Stop'
$adbPath = 'C:/Users/Home/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$profiles = @(
    @{ name='phone360-portrait'; size='360x800'; font='1.0'; language='en'; theme='Light' },
    @{ name='phone360-landscape'; size='800x360'; font='1.0'; language='en'; theme='Light' },
    @{ name='tablet800-portrait'; size='800x1280'; font='1.0'; language='en'; theme='Light' },
    @{ name='tablet800-landscape'; size='1280x800'; font='1.0'; language='en'; theme='Light' },
    @{ name='tablet1280-portrait'; size='1280x1800'; font='1.0'; language='en'; theme='Light' },
    @{ name='tablet1280-landscape'; size='1800x1280'; font='1.0'; language='en'; theme='Light' },
    @{ name='phone360-font2-ko'; size='360x800'; font='2.0'; language='ko'; theme='Sepia' },
    @{ name='tablet1280-font2-dark'; size='1800x1280'; font='2.0'; language='en'; theme='Dark' }
)
$destination = Join-Path $PSScriptRoot 'stage4-screens'
New-Item -ItemType Directory -Force $destination | Out-Null
foreach ($capture in ($profiles | Where-Object { $Profile -eq 'all' -or $_.name -eq $Profile })) {
    & $adbPath -s emulator-5554 shell wm size $capture.size
    & $adbPath -s emulator-5554 shell wm density 160
    & $adbPath -s emulator-5554 shell settings put system font_scale $capture.font
    $log = Join-Path $PSScriptRoot ('stage4-capture-' + $capture.name + '.log')
    # No data clearing, Activity replacement, global adb changes or peer-device commands.
    $previousAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue' # Native renderer diagnostics are stderr, not test failure.
    & $adbPath -s emulator-5554 shell am instrument -w -e class 'app.fractal.reader.DiscoveryNativeTest#capturesCurrentScholarlyDestinations' -e captureProfile $capture.name -e captureLanguage $capture.language -e captureTheme $capture.theme app.fractal.reader.test/androidx.test.runner.AndroidJUnitRunner *> $log
    $ErrorActionPreference = $previousAction
    if (!(Select-String -Path $log -Pattern 'OK \(1 test\)' -Quiet)) { throw ('Native capture failed: ' + $log) }
    & $adbPath -s emulator-5554 pull ('/sdcard/Android/data/app.fractal.reader/files/stage4-qa/' + $capture.name) $destination
    Write-Output ('Captured ' + $capture.name)
}
