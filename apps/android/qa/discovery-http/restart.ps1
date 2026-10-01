$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$runtime = Join-Path $PSScriptRoot 'runtime'
$identity = Get-Content (Join-Path $runtime 'server-identity.json') -Raw | ConvertFrom-Json
$launch = Get-Content (Join-Path $runtime 'launch-identity.json') -Raw | ConvertFrom-Json
$owned = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $identity.pid)
if ($owned.ExecutablePath -ne $launch.ExecutablePath -or $owned.CommandLine -ne $launch.CommandLine -or
    ([datetimeoffset]$owned.CreationDate).ToUnixTimeMilliseconds() -ne ([datetimeoffset]$launch.CreationDate).ToUnixTimeMilliseconds()) { throw 'Owned helper executable/start/command mismatch' }
$ports = @($identity.internalPort, $identity.proxyPort, $identity.controlPort)
$listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports })
if ($listeners.Count -ne 3 -or ($listeners | Where-Object { $_.OwningProcess -ne $identity.pid })) { throw 'Owned listener mismatch' }
if (!(Resolve-Path $identity.directory).Path.StartsWith((Resolve-Path $runtime).Path + '\')) { throw 'Resume directory escaped helper runtime' }
$stop = Join-Path $runtime 'stop'
New-Item -ItemType File -Path $stop -Force | Out-Null
Start-Sleep -Milliseconds 1000
if (Get-Process -Id $identity.pid -ErrorAction SilentlyContinue) { throw 'Owned helper did not exit' }
if (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $ports }) { throw 'Owned ports remain open' }
Copy-Item -LiteralPath (Join-Path $runtime 'final-state.json') -Destination (Join-Path $PSScriptRoot ('../stage4-http-helper-' + $identity.pid + '.json'))
Push-Location $workspace
try {
    node apps/android/qa/discovery-http/build.mjs
    if ($LASTEXITCODE -ne 0) { throw 'QA helper build failed' }
    Remove-Item -LiteralPath $stop
    $env:FRACTAL_D_QA_RESUME = $identity.directory
    $process = Start-Process -FilePath $launch.ExecutablePath -ArgumentList 'apps/android/qa/discovery-http/server.bundle.mjs' -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.stdout.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server.stderr.log') -PassThru
    Get-CimInstance Win32_Process -Filter ('ProcessId=' + $process.Id) | Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $runtime 'launch-identity.json')
    Write-Output ('Verified helper ' + $identity.pid + ' exited; same owned runtime resumed by ' + $process.Id)
} finally { Remove-Item Env:FRACTAL_D_QA_RESUME -ErrorAction SilentlyContinue; Pop-Location }
