"""Read immutable accepted evidence and a root-delivered APK; never operate devices."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
APK = Path('C:/Users/Home/Desktop/Fractal/fractal/dist/reviewed-builds/android-e690dca/Fractal-0.1.0-android-debug.apk')
INSTALLER = Path('C:/Users/Home/Desktop/Fractal/fractal/dist/reviewed-builds/desktop-0efa96c/Fractal Setup 0.1.0.exe')

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

d4 = read(ROOT / 'apps/android/qa/stage4-artifact-manifest.json')
d3 = read(ROOT / 'apps/android/qa/stage3-final-screens/manifest.json')
d3_rows = [{'path': row['file'], 'sha256': row['sha256']} for row in d3['screens']]
if isinstance(d3_rows, dict):
    raise ValueError('Unexpected screenshot manifest shape')

def verify_rows(rows, base):
    bad = []
    for row in rows:
        file = base / row['path']
        if not file.is_file() or sha(file) != row['sha256'].lower():
            bad.append(row['path'])
    return {'count': len(rows), 'mismatches': bad}

# Paths in the D3 manifest are relative to its own directory; D4 to Android QA.
screens = {
    'acceptedReader': verify_rows(d3_rows, ROOT / 'apps/android/qa/stage3-final-screens'),
    'acceptedDiscovery': verify_rows(d4['screenshots'], ROOT / 'apps/android/qa'),
}
revision_counts = {}
for row in d4['screenshots']:
    revision = row.get('observedAppApkSha256') or 'historical-no-recorded-apk-revision'
    revision_counts[revision] = revision_counts.get(revision, 0) + 1

actual_apk = {'path': str(APK), 'bytes': APK.stat().st_size, 'sha256': sha(APK)}
expected = d4['apks'][0]
assert actual_apk['bytes'] == expected['bytes']
assert actual_apk['sha256'] == expected['sha256']
assert all(not result['mismatches'] for result in screens.values())
package = read(ROOT / 'docs/implementation/desktop/selection-repair/packaged.json')
resources = read(ROOT / 'docs/implementation/desktop/selection-repair/package-resources.json')
icons = read(ROOT / 'docs/implementation/desktop/selection-repair/native-icons.json')
assert package['source'] == '0efa96c7575435d9ce408c4dcc2ce427134e9141'
assert package['status'] == 'passed' and package['runtimeIdentity']['packaged']
assert package['runtimeIdentity']['appPath'].endswith('app.asar')
assert package['ownedProcessExited'] and resources['mainProcessExited'] and resources['listenerReleased']
assert all(item['matchesBuiltSource'] for item in resources['resources'])
assert resources['excludedVerificationInputs'] and not resources['installerInstalled']
for case in package['cases']:
    assert case['beforeUp']['text'] == case['expected'] == case['afterUp']['text'] == case['copied']
    if 'menuCopy' in case:
        assert case['menuCopy'] == case['expected']
assert package['electron-reopened']['saved']['text'] == 'dominant'
assert package['electron-quote-draft']['text'] == 'dominant'
assert 'layoutRange' not in package['electron-quote-draft']['provenance']
assert icons['status'] == 'passed'
assert all(image['equalsAcceptedIco'] for artifact in icons['artifacts'] for group in artifact['matchingBranchGroups'] for image in group['images'])
installer = {'path': str(INSTALLER), 'bytes': INSTALLER.stat().st_size, 'sha256': sha(INSTALLER)}
assert installer['bytes'] == 117588001 and installer['sha256'] == '63ee8767cf28671a1d140dada62502b51ebddfb9f2e515c7cc020714cb52b986'
pointer = read(OUT / 'word-pointer-evidence/verification.json')
assert pointer['browserStatus'] == 'passed' and not pointer['errors']
for case in pointer['cases']:
    assert case['before']['text'] == case['expected'] == case['after']['text'] == case['ctrlCopy']
screens['independentRepairedDesktop'] = verify_rows([{'path': item['file'], 'sha256': item['sha256']} for item in pointer['screenshots']], OUT / 'word-pointer-evidence')
assert not screens['independentRepairedDesktop']['mismatches']
result = {
    'acceptanceStatus': {'android': 'accepted software gates', 'desktop': 'accepted repaired source, actual independent browser pointer and immutable owner native packaged proof', 'overall': 'requests1-13 accepted at stated software boundaries; request14 excluded'},
    'reviewedAcceptedSource': '71fae0d6c6af45a39781b22e419fb7ebb68f0914',
    'androidReviewSource': '594f418d6e9ba374b9f2b5a220d0541270a4416b',
    'androidProductSource': d4['productSourceSha'],
    'desktopPackagedProductSource': package['source'],
    'desktopIndependentPointerExecutionSource': pointer['sourceSha'],
    'desktopPackageArtifactsOwnerManifest': package['artifacts'],
    'independentlyInspectedRootDeliveredInstaller': installer,
    'desktopNativeBoundary': pointer['electronNotExecuted'],
    'desktopOwnerActualPackageProcess': package['processIdentity'],
    'desktopPackageResourcesAllMatchAcceptedBuild': True,
    'desktopPackageOwnedProcessAndListenerClosed': True,
    'eCompiledHubBundleSha256': sha(ROOT / 'apps/desktop/dist/hub.mjs'),
    'eBrowserHubLoadBoundary': 'startService loaded accepted e5e85dd TypeScript production source in-process; compiled bundle hash is build inspection, not a claim that this bundle was loaded there',
    'screenshotVerification': screens,
    'discoveryScreenshotApkRevisions': revision_counts,
    'captureProfiles': d4['captureProfiles'],
    'androidUnitTotals': d4['unitTotals'],
    'independentlyInspectedRootDeliveredApk': actual_apk,
    'testApkOwnerManifest': d4['apks'][1],
    'debugSigningOwnerManifest': d4['debugSigning'],
    'nativeExecutionBoundary': 'Owner D emulator-5554/API34; E final review does not operate that device or claim an E final APK installation.',
    'limits': ['API29 runtime not executed', 'API35 native frame/index equivalence not executed', 'Physical S Pen/palm/hover/latency not executed', 'Windows installer installation/pinned taskbar not observed'],
}
(OUT / 'final-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'screenshots': screens, 'apkMatches': True, 'currentInstallerMatches': True, 'actualPackagedPointerAndResources': 'passed'}, ensure_ascii=False))
