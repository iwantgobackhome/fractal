"""Record SDK disassembly delta; retain literal nonidentity and manual semantic scope."""
import difflib
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import zipfile

ci_apk, runtime_apk, commit, run_id = sys.argv[1:5]
base = pathlib.Path('docs/implementation/qa/v020/data/dex-review').resolve()
base.mkdir(parents=True, exist_ok=True)
sdk = pathlib.Path('C:/Users/Home/AppData/Local/Android/Sdk/build-tools/35.0.0/dexdump.exe')
sha = lambda data: hashlib.sha256(data).hexdigest()
descriptions = []


def normalize(text):
    lines = []
    for line in text.splitlines():
        if '|' in line:
            line = line.split('|', 1)[1]
            line = re.sub(r'^\[[0-9a-f]+\] ', '', line)
            line = re.sub(r'^[0-9a-f]{4}: ', '', line)
        # Positions/locals contain code offsets; preserve source lines and types.
        lines.append(re.sub(r'0x[0-9a-f]+', '<offset>', line))
    return '\n'.join(lines)


for label, apk in [('ci', ci_apk), ('runtime', runtime_apk)]:
    with zipfile.ZipFile(apk) as archive:
        dex = archive.read('classes8.dex')
    path = base / (label + '-classes8.dex')
    path.write_bytes(dex)
    dump = subprocess.check_output([str(sdk), '-d', '-f', str(path)], text=True, encoding='utf-8', errors='replace')
    (base / (label + '-dump.txt')).write_text(dump, encoding='utf-8')
    classes = {}
    for part in re.split(r'(?m)^Class #\d+\s*-\s*$', dump)[1:]:
        descriptor = re.search(r"Class descriptor\s*:\s*'([^']+)'", part).group(1)
        members = {}
        chunks = re.split(r'(?m)^    #\d+\s*: \(in .*\)\s*$', part)
        for chunk in chunks[1:]:
            name = re.search(r"name\s*:\s*'([^']+)'", chunk)
            signature = re.search(r"type\s*:\s*'([^']+)'", chunk)
            if name and signature:
                members[name.group(1) + signature.group(1)] = normalize(chunk)
        classes[descriptor] = {'normalized': normalize(part), 'members': members}
    descriptions.append({'sha256': sha(dex), 'bytes': len(dex), 'classes': classes})

a, b = descriptions
assert a['classes'].keys() == b['classes'].keys()
changed = []
class_hashes = []
for descriptor, first in a['classes'].items():
    second = b['classes'][descriptor]
    assert first['members'].keys() == second['members'].keys()
    differing_members = [name for name, body in first['members'].items() if body != second['members'][name]]
    class_hashes.append({'descriptor': descriptor, 'ci': sha(first['normalized'].encode()), 'runtime': sha(second['normalized'].encode())})
    if first['normalized'] != second['normalized']:
        changed.append({'descriptor': descriptor, 'members': differing_members,
                        'diff': '\n'.join(difflib.unified_diff(first['normalized'].splitlines(), second['normalized'].splitlines(), fromfile='CI', tofile='runtime'))})
assert len(class_hashes) == 797
assert {entry['descriptor'] for entry in changed} == {
    'Lapp/fractal/reader/ResearchDeskKt;',
    'Lapp/fractal/reader/ResearchDeskKt$ResearchDesk$1$1$1$1$1;',
    'Lapp/fractal/reader/ResearchDeskKt$ResearchDesk$1$1$1$1$2$1;'
}
assert sum(len(entry['members']) for entry in changed) == 3
for mask in (6, 147, 1171, 9363):
    assert mask & 8 == 0
    assert (3072 & mask) == ((3072 | 8) & mask)
    assert (0 & mask) == (8 & mask)
report = {'acceptedSourceCommit': commit, 'actualCiRun': run_id,
          'scope': 'SDK35 actual classes8 disassembly; only printed byte/code-position addresses normalized; no APK installation',
          'ciDex': {'sha256': a['sha256'], 'bytes': a['bytes']},
          'runtimeDex': {'sha256': b['sha256'], 'bytes': b['bytes']},
          'sameClasses': len(class_hashes), 'unchangedClasses': len(class_hashes) - len(changed),
          'changedMembers': changed, 'allClassHashes': class_hashes,
          'exactDexByteMatch': False,
          'manualSemanticReview': {
              'actualReaderApplicationStableInitializer': 8,
              'readerApplicationEqualsOverride': False,
              'receiverAppChangeMask': 6,
              'receiverSkipMasks': {'ResearchDesk': 147, 'DiscoveryScreen': 1171, 'ScholarlyLibraryScreen': 9363, 'PaperDiscoveryDetail': 9363},
              'maskBit8Excluded': True,
              'actualCiComposerImpl': 'classes.dex: changed(Object) and changedInstance(Object) use identical nextSlot/updateValue/boolean paths; only equality versus reference comparison differs',
              'identityDomain': 'ReaderApplication inherits identity equality; valid previous app slot is that instance, another app instance, or empty sentinel',
              'correspondence': 'PASS source/resources/action/transport and render semantic scope; APK and classes8 bytes remain nonidentical',
              'buildCause': 'clean versus incremental Compose stability inference is an inference, not proven build provenance'
          }}
pathlib.Path('docs/implementation/qa/v020/apk-dex-review.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'sameClasses': 797, 'unchangedClasses': 794, 'changedMembers': [{k: v for k, v in entry.items() if k != 'diff'} for entry in changed], 'exactDexByteMatch': False}, indent=2))
