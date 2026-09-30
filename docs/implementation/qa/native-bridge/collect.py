"""Collect only E-owned, disposable native evidence; credentials stay in runtime."""
import hashlib
import io
import json
import pathlib
import subprocess
import urllib.request
import zipfile

root = pathlib.Path.cwd()
owned = root / 'docs/implementation/qa/native-bridge'
runtime = owned / 'runtime'
evidence = owned / 'evidence'
evidence.mkdir(exist_ok=True)
adb = 'C:/Users/Home/AppData/Local/Android/Sdk/platform-tools/adb.exe'

def device(*args):
    return subprocess.check_output([adb, '-s', 'emulator-5560', *args])

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

for filename in ['native-bridge.txt', 'bridge-offline.json', 'bridge-reconnected.json', 'bridge-folder-deleted.json', 'offline-cached-reader.png']:
    device('pull', '/sdcard/Android/data/app.fractal.reader/files/' + filename, str(evidence / filename))

source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
snapshot = runtime / 'android-snapshot'
archive = subprocess.check_output(['git', 'archive', '--format=zip', source, 'apps/android', 'packages/shared/tokens'])
matched = 0
with zipfile.ZipFile(io.BytesIO(archive)) as accepted:
    for entry in accepted.infolist():
        if entry.is_dir():
            continue
        assert (snapshot / entry.filename).read_bytes() == accepted.read(entry), entry.filename
        matched += 1
apk_root = snapshot / 'apps/android/app/build/outputs/apk'
identity = json.loads((runtime / 'server-identity.json').read_text())
identity['executable'] = 'C:/Program Files/nodejs/node.exe'
identity['bundleSha256'] = sha(owned / 'server.bundle.mjs')
identity['launchIdentities'] = json.loads((runtime / 'launch-identities.json').read_text(encoding='utf-8-sig'))
summary = {
    'acceptedSourceSha': source,
    'acceptedSnapshotFilesByteMatched': matched,
    'apkSha256': sha(apk_root / 'debug/app-debug.apk'),
    'testApkSha256': sha(apk_root / 'androidTest/debug/app-debug-androidTest.apk'),
    'hub': identity,
    'serial': 'emulator-5560',
    'api': device('shell', 'getprop', 'ro.build.version.sdk').decode().strip(),
    'avd': device('emu', 'avd', 'name').decode().strip(),
    'reverse': device('reverse', '--list').decode().strip().splitlines(),
}
(evidence / 'identity.json').write_text(json.dumps(summary, indent=2) + '\n')
with urllib.request.urlopen('http://127.0.0.1:6175/E/state') as response:
    (evidence / 'server-after.json').write_bytes(response.read())
wire = json.loads((runtime / 'wire.json').read_text())
e_wire = [w for w in wire if any(p['paperKey'] == 'qa-reader-catalog' for p in w['body'].get('papers', []))
          or any(a['paperKey'] == 'qa-reader-catalog' for a in w['body'].get('annotations', []))
          or any(f['id'].startswith('qa-bridge-') for f in w['body'].get('folders', []))]
(evidence / 'wire.json').write_text(json.dumps(e_wire, indent=2) + '\n')
def copy_log(path):
    raw = path.read_bytes()
    content = raw.decode('utf-16') if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else raw.decode('utf-8')
    content = content.replace('\r\n', '\n').replace('\r', '')
    (evidence / path.name).write_bytes(('\n'.join(line.rstrip() for line in content.split('\n')).rstrip() + '\n').encode('utf-8'))

for path in sorted(runtime.glob('instrumentation-*.log')):
    copy_log(path)
for name in ['android-build.log', 'android-rebuild-5.log']:
    copy_log(runtime / name)
(evidence / 'native-semantics.log').write_bytes(device('logcat', '-d', 'E-native-bridge:D', '*:S'))
tokens = [json.loads((runtime / f'{owner}-private.json').read_text())['deviceToken'].encode() for owner in ['D', 'E']]
for path in evidence.iterdir():
    assert not any(token in path.read_bytes() for token in tokens), 'Private token in ' + path.name
print('Collected credential-free E evidence; matched accepted source files:', matched)
