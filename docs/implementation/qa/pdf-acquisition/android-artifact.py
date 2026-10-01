"""Read-only inspection of the explicitly supplied frozen Android application APK."""
import datetime, hashlib, json, pathlib, struct, subprocess, zipfile

root = pathlib.Path(__file__).resolve().parents[4]
owner = pathlib.Path('C:/Users/Home/orca/workspaces/fractal/fractal-pdf-acquisition-android')
proof = owner / 'apps/android/qa/pdf-acquisition'
manifest_path = proof / 'artifact-manifest.json'
m = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
apk = pathlib.Path('C:/Users/Home/Desktop/Fractal/fractal/dist/reviewed-builds/android-pdf-b940fd0/Fractal-0.1.0-android-debug.apk')
sdk = pathlib.Path('C:/Users/Home/AppData/Local/Android/Sdk/build-tools/35.0.0')
def sha(b): return hashlib.sha256(b).hexdigest()
def run(args): return subprocess.check_output(args, cwd=root).decode('utf-8', errors='replace')
def dex_classes(b):
    assert b[:4] == b'dex\n'
    def u32(p): return struct.unpack_from('<I', b, p)[0]
    def string_at(p):
        while b[p] & 128: p += 1
        p += 1
        return b[p:b.index(b'\0',p)].decode('utf-8', errors='replace')
    strings = [string_at(u32(u32(60)+4*i)) for i in range(u32(56))]
    types = [strings[u32(u32(68)+4*i)] for i in range(u32(64))]
    return [types[u32(u32(100)+32*i)] for i in range(u32(96))]

assert apk.stat().st_size == m['apkBytes'] == 69961372
assert sha(apk.read_bytes()) == m['apkSha256'] == '086b78bebf11f48012efe3f59356dce86e648fd800d4c55ac559315ecd24c842'
assert sha(pathlib.Path(m['artifactPath']).read_bytes()) == m['apkSha256']
signature = run([str(sdk/'apksigner.bat'), 'verify', '--verbose', '--print-certs', str(apk)])
assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in signature
assert m['signerCertificateSha256'] in signature
badging = run([str(sdk/'aapt2.exe'), 'dump', 'badging', str(apk)])
assert "package: name='app.fractal.reader'" in badging
assert 'app.fractal.reader.MainActivity' in badging
inputs = []
for item in m['productionInputHashes']:
    p = item['path']
    assert p.startswith('apps/android/') and '..' not in pathlib.PurePosixPath(p).parts
    blob = subprocess.check_output(['git', 'show', 'HEAD:'+p], cwd=root)
    lf = blob.replace(b'\r\n', b'\n')
    variants = [sha(blob), sha(lf), sha(lf.replace(b'\n', b'\r\n'))]
    raw = (owner/p).read_bytes()
    assert sha(raw) == item['sha256'], p
    assert raw.replace(b'\r\n',b'\n') == lf, p
    inputs.append(dict(item, acceptedGitBlobHash=sha(blob), independentlyVerifiedOwnerRawHash=sha(raw), lineEndingOnlyDifference=sha(blob)!=item['sha256']))
trees = {}
for component, expected in m['productionMainTrees'].items():
    actual = run(['git','rev-parse', 'HEAD:apps/android/'+component+'/src/main']).strip()
    assert actual == expected, component
    trees[component] = actual
resources, classes = [], {}
with zipfile.ZipFile(apk) as z:
    for item in m['packagedResourceHashes']:
        b = z.read(item['path'])
        assert len(b)==item['bytes'] and sha(b)==item['sha256'], item['path']
        resources.append(dict(item, independentHash=sha(b)))
    for p in z.namelist():
        if p.startswith('classes') and p.endswith('.dex'):
            classes[p] = dex_classes(z.read(p))
    resource_names = [p for p in z.namelist() if p.startswith(('res/','assets/','lib/')) or p in ['AndroidManifest.xml','resources.arsc']]
    declared = {i['path'] for i in resources}
    assert declared.issubset(resource_names)
    extra_resources = [dict(path=p,bytes=len(z.read(p)),sha256=sha(z.read(p))) for p in resource_names if p not in declared]
    bad_entries = [p for p in z.namelist() if 'androidTest' in p or 'NativeDeskDriver' in p or 'qa-pdf-acquisition' in p]
    assert not bad_entries
hits = [c for cs in classes.values() for c in cs if c.startswith('Lapp/fractal/') and ('Test' in c or 'NativeDeskDriver' in c)]
assert not hits, hits
all_classes = [c for cs in classes.values() for c in cs]
assert 'Lapp/fractal/reader/MainActivity;' in all_classes
debug_fixture = [c for c in all_classes if 'ReaderFixtureActivity' in c]
evidence = dict(status='passed independent frozen application inspection; backend GET follow-up and owner final lifecycle remain separate',
    inspectedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), acceptedQaHead=run(['git','rev-parse','HEAD']).strip(),
    manifestPath=str(manifest_path), manifestSha256=sha(manifest_path.read_bytes()), declaredSource=m['sourceFreezeCommit'],
    nativeBackendBoundary=m['acceptedBackendSupply'], delivered=dict(path=str(apk),bytes=apk.stat().st_size,sha256=sha(apk.read_bytes()),matchesOwner=True),
    signature=signature,badging=badging,productionTrees=trees,sourceInputs=inputs,resources=resources,
    additionalSignedDependencyAssetsAndLibraries=extra_resources,
    dexClassCounts={k:len(v) for k,v in classes.items()},qaClassHits=hits,qaZipEntries=bad_entries,
    existingDebugFixtureClasses=debug_fixture,debugBuild=True,instrumentationApkDelivered=False,
    deviceOperated=False,apkInstalledByReviewer=False,limits='Owner API34 emulator/native evidence reviewed, not physical/API35 or new GET guard execution')
(root/'docs/implementation/qa/pdf-acquisition/evidence/android-artifact.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
print(f'Android APK verified: {len(inputs)} source inputs, {len(resources)} exact resources, {len(all_classes)} DEX classes, no QA classes')
