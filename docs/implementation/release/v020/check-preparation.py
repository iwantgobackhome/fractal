"""Focused release preparation gates. Requires Python 3 and PyYAML; no packaging."""
from pathlib import Path
import hashlib
import json
import os
import re
import struct
import subprocess
import yaml

root = Path(__file__).resolve().parents[4]
os.chdir(root)
workflow = yaml.load(Path('.github/workflows/release.yml').read_text(), Loader=yaml.BaseLoader)
assert workflow['permissions'] == {'contents': 'read'}
assert workflow['on']['push']['branches'] == ['release/**']
assert workflow['on']['push']['tags'] == ['v*']
assert 'workflow_dispatch' in workflow['on']
jobs = workflow['jobs']
assert set(jobs) == {'versions','desktop','android','checksums','publication'}
matrix = jobs['desktop']['strategy']['matrix']['include']
assert {(row['os'],row['platform'],row['arch']) for row in matrix} == {
    ('windows-2025','win32','x64'), ('ubuntu-24.04','linux','x64'),
    ('macos-15','darwin','arm64'), ('macos-15-intel','darwin','x64')}
assert set(jobs['checksums']['needs']) == {'versions','desktop','android'}
assert set(jobs['publication']['needs']) == {'versions','desktop','android','checksums'}
assert jobs['publication']['permissions'] == {'contents':'write'}
assert "refs/tags/v" in jobs['publication']['if']
for name,job in jobs.items():
    if name != 'publication': assert 'permissions' not in job
    for step in job['steps']:
        if step.get('uses','').startswith('actions/setup-node@'):
            assert step['with']['node-version'] == '22.23.1'
runs = '\n'.join(step.get('run','') for step in jobs['desktop']['steps'])
assert 'npm ci' in runs and '--publish never' in runs
assert runs.index('npm run build -w @fractal/shared') < runs.index('npm run typecheck')
assert 'smoke-packaged-release.mjs' in runs and 'release-manifest.mjs' in runs
publish = '\n'.join(step.get('run','') for step in jobs['publication']['steps'])
assert '--verify-tag --draft' in publish and 'sha256sum --check SHA256SUMS.txt' in publish
android = '\n'.join(step.get('run','') for step in jobs['android']['steps'])
assert android.index('restore-android-debug-key.mjs') < android.index(':app:assembleDebug')
assert 'verify-android-release.mjs' in android and 'build-tools;35.0.0' in android
assert 'ANDROID_RELEASE_CERT_SHA256' in Path('.github/workflows/release.yml').read_text()

pkg = json.loads(Path('package.json').read_text())
assert pkg['devDependencies']['electron'] == '44.4.5'
assert pkg['devDependencies']['electron-builder'] == '26.15.3'
build = pkg['build']
assert 'node_modules/@lydell/node-pty-*/**' in build['files']
assert 'node_modules/@lydell/node-pty-*/**' in build['asarUnpack']
assert build['artifactName'] == 'Fractal-${version}-${os}-${arch}.${ext}'
assert build['win']['target'] == [{'target':'nsis','arch':['x64']}]
assert build['mac']['target'] == [{'target':'dmg','arch':['arm64','x64']}]
assert build['linux']['target'] == [{'target':'AppImage','arch':['x64']},{'target':'deb','arch':['x64']}]

png = Path('apps/desktop/assets/icon-512.png').read_bytes()
assert png[:8] == b'\x89PNG\r\n\x1a\n'
assert struct.unpack('>II',png[16:24]) == (512,512)
icns = Path('apps/desktop/assets/fractal.icns').read_bytes()
assert icns[:4] == b'icns' and struct.unpack('>I',icns[4:8])[0] == len(icns)
offset=8; types=[]
while offset < len(icns):
    kind=icns[offset:offset+4].decode('ascii'); length=struct.unpack('>I',icns[offset+4:offset+8])[0]
    assert icns[offset+8:offset+16] == b'\x89PNG\r\n\x1a\n'
    types.append(kind); offset += length
assert offset == len(icns) and types == ['icp4','icp5','icp6','ic07','ic08','ic09','ic10']
original_assets = subprocess.check_output(['git','ls-tree','-r','--name-only','239e444c','apps/desktop/assets']).decode().splitlines()
for path in original_assets:
    accepted = subprocess.check_output(['git','show','239e444c:'+path])
    actual = Path(path).read_bytes()
    # Accepted SVGs may have Windows checkout line endings; raster bytes must match exactly.
    if path.endswith('.svg'): accepted=accepted.replace(b'\r\n',b'\n'); actual=actual.replace(b'\r\n',b'\n')
    assert actual == accepted, 'accepted icon changed: '+path

readmes = ['README.md','README.ko.md','README.ja.md','README.zh-CN.md']
for filename in readmes:
    text=Path(filename).read_text(encoding='utf-8')
    original=subprocess.check_output(['git','show','239e444c:'+filename]).decode('utf-8')
    assert text.splitlines()[0] == original.splitlines()[0], 'multilingual navigation drift'
    for name in readmes: assert name in text.splitlines()[0] or name == filename
    for suffix in ['win-x64.exe','linux-x64.AppImage','linux-x64.deb','mac-arm64.dmg','mac-x64.dmg','android-debug.apk']:
        assert 'Fractal-0.2.0-'+suffix in text
    assert '\ufffd' not in text and '|  |' not in text
    assert not re.search(r'docs/assets/readme/[^\s)"]+\.png',text), 'stale dashboard screenshot'
for filename in readmes+['apps/desktop/README.md','apps/android/README.md','docs/RELEASING.md','docs/releases/0.2.0.md','CHANGELOG.md']:
    path=Path(filename); text=path.read_text(encoding='utf-8')
    links=re.findall(r'\]\(([^)]+)\)',text)+re.findall(r'(?:src|srcset|href)="([^"]+)"',text)
    for link in links:
        if link.startswith(('http:','https:','#','mailto:')): continue
        assert (path.parent/link.split('#')[0]).exists(), 'broken local link: '+filename+' -> '+link

version_command=['node','scripts/verify-release-version.mjs']
base={k:v for k,v in os.environ.items() if not k.startswith('GITHUB_REF')}
subprocess.run(version_command,check=True,env=base)
for kind,name,expected in [('tag','v0.2.0',0),('tag','v0.1.0',1),('tag','v0.2.0-rc.1',1),('branch','release/v020',0),('branch','main',1)]:
    result=subprocess.run(version_command,env={**base,'GITHUB_REF_TYPE':kind,'GITHUB_REF_NAME':name},capture_output=True)
    assert (result.returncode == 0) == (expected == 0), (kind,name,result.stderr)
missing_key=subprocess.run(['node','scripts/restore-android-debug-key.mjs'],env={**base,'ANDROID_DEBUG_KEYSTORE_BASE64':''},capture_output=True)
assert missing_key.returncode != 0
for path in list(Path('scripts').glob('*release*.mjs'))+[Path('scripts/release-config.cjs'),Path('scripts/packaged-release-probe.cjs'),Path('scripts/restore-android-debug-key.mjs'),Path('apps/desktop/tools/generate-distribution-icons.mjs')]:
    subprocess.run(['node','--check',str(path)],check=True)
subprocess.run(['node','-e',"require('app-builder-lib/out/util/config/config.js').getConfig(process.cwd(),'scripts/release-config.cjs').then(c=>require('app-builder-lib/out/util/config/config.js').validateConfiguration(c)).then(()=>console.log('electron-builder CJS load/schema passed'))"],check=True)
print('PASS: workflow permissions/native matrix, version branch/tag negative gates, artifact names, stable signing failure, icon identity/containers, multilingual links and v26 schema')
