$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot 'runtime'
$identity = Get-Content (Join-Path $runtime 'server-identity.json') -Raw | ConvertFrom-Json
$launch = Get-Content (Join-Path $runtime 'launch-identity.json') -Raw | ConvertFrom-Json
$owned = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $identity.pid)
if ($owned.ExecutablePath -ne $launch.ExecutablePath -or $owned.CommandLine -ne $launch.CommandLine -or
    ([datetimeoffset]$owned.CreationDate).ToUnixTimeMilliseconds() -ne ([datetimeoffset]$launch.CreationDate).ToUnixTimeMilliseconds()) { throw 'Helper executable/start/command mismatch' }
$ports = @($identity.internalPort, $identity.proxyPort, $identity.controlPort)
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports })
if ($listeners.Count -ne 3 -or ($listeners | Where-Object { $_.OwningProcess -ne $identity.pid -or $_.LocalAddress -ne '127.0.0.1' })) { throw 'Helper listener ownership mismatch' }
if (!(Resolve-Path $identity.directory).Path.StartsWith((Resolve-Path $runtime).Path + '\')) { throw 'Helper runtime escaped owned directory' }

# This exact read-only5554 instance was supplied exclusively to D. No AVD deletion.
$emulator = Get-CimInstance Win32_Process -Filter 'ProcessId=47840'
$qemu = Get-CimInstance Win32_Process -Filter 'ProcessId=37140'
if ($emulator.ExecutablePath -ne 'C:\Users\Home\AppData\Local\Android\Sdk\emulator\emulator.exe' -or
    ([datetimeoffset]$emulator.CreationDate).ToUnixTimeMilliseconds() -ne 1790803237810 -or
    $emulator.CommandLine -notmatch '-avd Pixel_2_API_34 -port 5554 -read-only -no-window -no-audio -no-snapshot -no-boot-anim -gpu swiftshader_indirect') { throw 'Emulator launcher identity mismatch' }
if ($qemu.ParentProcessId -ne $emulator.ProcessId -or
    $qemu.ExecutablePath -ne 'C:\Users\Home\AppData\Local\Android\Sdk\emulator\qemu\windows-x86_64\qemu-system-x86_64-headless.exe' -or
    ([datetimeoffset]$qemu.CreationDate).ToUnixTimeMilliseconds() -ne 1790803237938 -or
    $qemu.CommandLine -notmatch '-avd Pixel_2_API_34 -port 5554 -read-only') { throw 'Emulator qemu identity mismatch' }
$consoleListeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 5554,5555 })
if ($consoleListeners.Count -lt 2 -or ($consoleListeners | Where-Object { $_.OwningProcess -ne $qemu.ProcessId })) { throw 'Emulator console ownership mismatch' }
$adbPath = 'C:/Users/Home/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$profile = @{
    size = (& $adbPath -s emulator-5554 shell wm size) -join "`n"
    density = (& $adbPath -s emulator-5554 shell wm density) -join "`n"
    fontScale = (& $adbPath -s emulator-5554 shell settings get system font_scale) -join "`n"
    productLocaleThemeRestore = 'stage4-resource-profile-restore.log: actual MainActivity, en/Light/font1'
}
if ($profile.size -notmatch 'Physical size: 1080x1920' -or $profile.size -match 'Override' -or
    $profile.density -notmatch 'Physical density: 420' -or $profile.density -match 'Override' -or $profile.fontScale.Trim() -ne '1.0') { throw 'Owned profile restoration incomplete' }
$peerBefore = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 5560,5561 } | Select-Object LocalAddress,LocalPort,OwningProcess)
$before = @{
    verifiedAt = [datetime]::UtcNow.ToString('o')
    helper = $owned | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n='startedUtc';e={$_.CreationDate.ToUniversalTime().ToString('o')}}
    helperListeners = $listeners | Select-Object LocalAddress,LocalPort,OwningProcess
    emulator = $emulator | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n='startedUtc';e={$_.CreationDate.ToUniversalTime().ToString('o')}}
    qemu = $qemu | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,@{n='startedUtc';e={$_.CreationDate.ToUniversalTime().ToString('o')}}
    consoleListeners = $consoleListeners | Select-Object LocalAddress,LocalPort,OwningProcess
    restoredProfile = $profile
    peer5560Listeners = $peerBefore
}
New-Item -ItemType File -Path (Join-Path $runtime 'stop') -Force | Out-Null
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Process -Id $identity.pid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
if (Get-Process -Id $identity.pid -ErrorAction SilentlyContinue) { throw 'Helper did not gracefully exit' }
if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports }) { throw 'Helper ports remain open' }
Copy-Item -LiteralPath (Join-Path $runtime 'final-state.json') -Destination (Join-Path $PSScriptRoot '../stage4-http-final-state.json')
& $adbPath -s emulator-5554 reverse --remove tcp:6274
& $adbPath -s emulator-5554 reverse --remove tcp:6275
& $adbPath -s emulator-5554 emu kill
if ($LASTEXITCODE -ne 0) { throw 'Scoped emulator console close failed' }
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Process -Id $emulator.ProcessId,$qemu.ProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
if (Get-Process -Id $emulator.ProcessId,$qemu.ProcessId -ErrorAction SilentlyContinue) { throw 'Owned emulator processes remain alive' }
$remaining = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in ($ports + @(5554,5555,5822,4919)) })
if ($remaining.Count) { throw 'Owned/current or prior D ports remain open' }
$peerAfter = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 5560,5561 } | Select-Object LocalAddress,LocalPort,OwningProcess)
@{
    before = $before
    closedAt = [datetime]::UtcNow.ToString('o')
    helperExited = $true; emulatorLauncherExited = $true; emulatorQemuExited = $true
    closedOwnedPorts = $ports + @(5554,5555,5822,4919)
    peer5560ListenersAfter = $peerAfter
    preserved = @('owned ignored QA SQLite/PDF profile', 'ignored private device credentials', 'application database and preferences; no reset', 'AVD; no deletion', 'global adb server and all peer processes')
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot '../stage4-resource-disposition.json')
Write-Output 'Verified owned helper and emulator5554 gracefully exited; owned current/prior ports closed; no peer/global operations.'
