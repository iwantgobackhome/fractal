param([Parameter(Mandatory=$true)][string]$AcceptedBackendSha)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$commit = (& git -C $root rev-parse HEAD).Trim()
if ((& git -C $root status --porcelain)) { throw 'Freeze requires a clean source checkpoint' }
& git -C $root merge-base --is-ancestor $AcceptedBackendSha $commit
if ($LASTEXITCODE -ne 0) { throw 'Accepted backend supply is not an ancestor' }
if ((& git -C $root diff $AcceptedBackendSha $commit -- packages/hub packages/shared)) { throw 'Backend differs from accepted supply' }
$sdk = $env:ANDROID_HOME
if (!$sdk) { $sdk = 'C:/Users/Home/AppData/Local/Android/Sdk' }
$buildTools = Join-Path $sdk 'build-tools/35.0.0'
$apk = Join-Path $root 'apps/android/app/build/outputs/apk/debug/app-debug.apk'
$testApk = Join-Path $root 'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-Utf8([string]$path, [string]$value) { [IO.File]::WriteAllText($path, $value, $utf8) }
$signing = (& (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $apk) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Application APK signature verification failed' }
$testSigning = (& (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $testApk) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Instrumentation APK signature verification failed' }
$badging = (& (Join-Path $buildTools 'aapt2.exe') dump badging $apk) -join "`n"
if ($LASTEXITCODE -ne 0 -or $badging -notmatch "package: name='app.fractal.reader'") { throw 'Unexpected application package/resources' }
Write-Utf8 (Join-Path $PSScriptRoot 'apk-signature.txt') $signing
Write-Utf8 (Join-Path $PSScriptRoot 'test-apk-signature.txt') $testSigning
Write-Utf8 (Join-Path $PSScriptRoot 'apk-badging.txt') $badging
$testTypes = @(Get-ChildItem (Join-Path $root 'apps/android/app/src/androidTest/java/app/fractal/reader') -Filter '*.kt' | ForEach-Object {
    foreach ($match in [regex]::Matches([IO.File]::ReadAllText($_.FullName), '(?m)^(?:internal |private )?(?:data )?class (\w+)')) { $match.Groups[1].Value }
} | Sort-Object -Unique)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($apk)
$resources = @(); $qaHits = @(); $qaMarkers = @('fractal-pdf-acquisition-private', 'pdf-acquisition-owned-5562')
try {
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -match '^classes.*\.dex$' -or $entry.FullName -eq 'resources.arsc' -or $entry.FullName -eq 'AndroidManifest.xml' -or $entry.FullName -match '^res/') {
            $memory = [IO.MemoryStream]::new(); $stream = $entry.Open()
            try { $stream.CopyTo($memory); $bytes = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
            if ($entry.FullName -match '^classes.*\.dex$') {
                $dex = [Text.Encoding]::ASCII.GetString($bytes)
                foreach ($name in $testTypes) { if ($dex.Contains("Lapp/fractal/reader/$name;")) { $qaHits += $name } }
                foreach ($marker in $qaMarkers) { if ($dex.Contains($marker)) { $qaHits += $marker } }
            } else {
                $digest = [Security.Cryptography.SHA256]::Create()
                try { $hash = ([BitConverter]::ToString($digest.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $digest.Dispose() }
                $resources += @{path=$entry.FullName;bytes=$entry.Length;sha256=$hash}
            }
        }
    }
} finally { $zip.Dispose() }
if ($qaHits.Count -ne 0) { throw "QA classes/markers in application APK: $($qaHits -join ', ')" }
$inputs = @(& git -C $root ls-files apps/android | Where-Object { $_ -notmatch '/qa/|/src/androidTest/|/src/test/' } | ForEach-Object {
    @{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $root $_) -Algorithm SHA256).Hash.ToLowerInvariant()}
})
$trees = @{}
foreach ($module in @('app', 'data', 'sync', 'pdf', 'ink', 'design')) { $trees[$module] = (& git -C $root rev-parse "${commit}:apps/android/$module/src/main").Trim() }
$artifact = Join-Path $root 'apps/android/app/build/outputs/apk/debug/Fractal-publication-read-debug.apk'
Copy-Item -LiteralPath $apk -Destination $artifact -Force
$manifest = [ordered]@{
    sourceFreezeCommit=$commit;acceptedBackendSupply=$AcceptedBackendSha;sourceRoot=$root;frozenAt=[DateTime]::UtcNow.ToString('o')
    artifactPath=$artifact;apkSha256=(Get-FileHash -LiteralPath $artifact).Hash.ToLowerInvariant();apkBytes=(Get-Item -LiteralPath $artifact).Length
    applicationId='app.fractal.reader';buildType='debug';signatureVerified=$true
    signerCertificateSha256=([regex]::Match($signing, 'certificate SHA-256 digest: ([a-f0-9]+)')).Groups[1].Value
    instrumentationApkSha256=(Get-FileHash -LiteralPath $testApk).Hash.ToLowerInvariant();instrumentationApkDelivered=$false
    applicationQaClassHits=@($qaHits);excludedQaTypes=$testTypes;excludedQaMarkers=$qaMarkers
    productionMainTrees=$trees;productionInputHashes=$inputs;packagedResourceHashes=$resources
}
Write-Utf8 (Join-Path $PSScriptRoot 'artifact-manifest.json') ($manifest | ConvertTo-Json -Depth 10)
Write-Output ($manifest | Select-Object sourceFreezeCommit, acceptedBackendSupply, artifactPath, apkSha256, apkBytes, applicationQaClassHits | ConvertTo-Json -Depth 3)
