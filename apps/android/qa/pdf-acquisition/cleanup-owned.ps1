$ErrorActionPreference = 'Stop'
$data = Join-Path $PSScriptRoot 'data'
$adb = 'C:/Users/Home/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-Receipt($value) { [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'resource-lifecycle.json'), ($value | ConvertTo-Json -Depth 15), $utf8) }
function Confirm-Identity([int]$identityPid, [long]$epoch, [string]$executable, [string]$command) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$identityPid"
    if (!$process -or ([DateTimeOffset]$process.CreationDate).ToUnixTimeMilliseconds() -ne $epoch -or
        $process.ExecutablePath -ne $executable -or $process.CommandLine.Trim() -ne $command.Trim()) { throw "Owned identity mismatch: $identityPid" }
    return @{pid=$identityPid;creationEpochMilliseconds=$epoch;executable=$process.ExecutablePath;command=$process.CommandLine}
}
function Confirm-Listeners([int[]]$ports, [int]$identityPid) {
    $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in $ports)
    if ($listeners.Count -eq 0 -or @($listeners | Where-Object OwningProcess -ne $identityPid).Count -ne 0) { throw 'Listener ownership mismatch' }
    foreach ($port in $ports) { if (!($listeners | Where-Object LocalPort -eq $port)) { throw "Owned listener missing: $port" } }
    return @($listeners | Select-Object LocalAddress, LocalPort, OwningProcess)
}
$old = Get-Content (Join-Path $data 'lifecycle.json') -Raw | ConvertFrom-Json
$emulator = Confirm-Identity 39892 1790830903659 'C:\Users\Home\AppData\Local\Android\Sdk\emulator\qemu\windows-x86_64\qemu-system-x86_64-headless.exe' 'C:\Users\Home\AppData\Local\Android\Sdk\emulator\qemu\windows-x86_64\qemu-system-x86_64-headless.exe -avd Pixel_2_API_34 -port 5562 -read-only -no-window -no-audio -no-snapshot -gpu swiftshader_indirect'
$launcher = Get-Content (Join-Path $data 'emulator-owner.json') -Raw | ConvertFrom-Json
$launcherIdentity = Confirm-Identity 45404 1790830903519 $launcher.ExecutablePath $launcher.CommandLine
$emulatorListeners = Confirm-Listeners @(5562,5563) 39892
$helperBefore = Get-Content (Join-Path $data 'current-helper-process.json') -Raw | ConvertFrom-Json
$helper = Confirm-Identity 44008 1790834394997 $helperBefore.ExecutablePath $helperBefore.CommandLine
$helperListeners = Confirm-Listeners @(4320,4321,6284,6285) 44008
$receipt = [ordered]@{started=[DateTime]::UtcNow.ToString('o');oldHelper=$old.oldHelper;emulator=$emulator;launcher=$launcherIdentity;emulatorListeners=$emulatorListeners;helper=$helper;helperListeners=$helperListeners;serial='emulator-5562';acceptedHelperSource='733be9846870428de95a0f36fec1050b0e013c8f'}
Write-Receipt $receipt
# All device commands target the newly created, exclusively owned read-only instance.
$deviceResults = @()
foreach ($arguments in @(@('shell','settings','put','system','font_scale','1'), @('shell','wm','size','reset'), @('shell','wm','density','reset'), @('reverse','--remove','tcp:6284'), @('reverse','--remove','tcp:6285'), @('shell','rm','/data/local/tmp/fractal-pdf-acquisition-private.json'), @('uninstall','app.fractal.reader.test'), @('uninstall','app.fractal.reader'))) {
    $output = (& $adb -s emulator-5562 @arguments) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Own device cleanup failed: $($arguments -join ' ')" }
    $deviceResults += @{arguments=$arguments;output=$output;exit=0}
}
$receipt.deviceRestoration=$deviceResults
$receipt.remainingOwnReverses=((& $adb -s emulator-5562 reverse --list) -join "`n")
if ($receipt.remainingOwnReverses -match 'tcp:628[45]') { throw 'Owned reverse remains' }
Confirm-Identity 39892 1790830903659 $emulator.executable $emulator.command | Out-Null
& $adb -s emulator-5562 emu kill | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Own emulator shutdown failed' }
Wait-Process -Id 39892,45404 -Timeout 30 -ErrorAction SilentlyContinue
if (Get-Process -Id 39892,45404 -ErrorAction SilentlyContinue) { throw 'Owned emulator did not exit' }
if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 5562,5563) { throw 'Owned emulator listeners remain' }
$receipt.emulatorGracefulExit=$true
$receipt.emulatorListenersClosed=$true
Confirm-Identity 44008 1790834394997 $helper.executable $helper.command | Out-Null
[IO.File]::WriteAllText((Join-Path $data 'stop'), 'identity-confirmed worker cleanup', $utf8)
Wait-Process -Id 44008 -Timeout 15 -ErrorAction SilentlyContinue
if (Get-Process -Id 44008 -ErrorAction SilentlyContinue) { throw 'Owned helper did not exit' }
if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in 4320,4321,6284,6285) { throw 'Owned helper listeners remain' }
$receipt.helperGracefulExit=$true
$receipt.helperListenersClosed=$true
Remove-Item -LiteralPath (Join-Path $data 'private.json')
$receipt.rawPrivateCredentialsRemoved=$true
$receipt.completed=[DateTime]::UtcNow.ToString('o')
$receipt.remainingAdbDevices=((& $adb devices -l) -join "`n")
Write-Receipt $receipt
Write-Output 'Owned device restored, owned emulator/helper exited, owned listeners closed, private credential file removed.'
