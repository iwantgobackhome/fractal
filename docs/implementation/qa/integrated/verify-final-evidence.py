"""Read immutable accepted evidence and a root-delivered APK; never operate devices."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
APK = Path('C:/Users/Home/Desktop/Fractal/fractal/dist/reviewed-builds/android-e690dca/Fractal-0.1.0-android-debug.apk')

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
result = {
    'acceptanceStatus': {'android': 'accepted software gates', 'overall': 'withheld: desktop request10 user-reproduced drag expansion; accepted repair/current package required'},
    'reviewedAcceptedSource': '594f418d6e9ba374b9f2b5a220d0541270a4416b',
    'androidProductSource': d4['productSourceSha'],
    'desktopPackagedProductSource': '08af7b3959a3816e8d54d6ea1f9886b253693d79',
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
print(json.dumps({'screenshots': screens, 'apkMatches': True}, ensure_ascii=False))
