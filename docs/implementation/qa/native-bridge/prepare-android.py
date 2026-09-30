"""Copy accepted tracked Android source into QA-owned scratch space; add only the bridge test."""
import io
import pathlib
import shutil
import subprocess
import zipfile

root = pathlib.Path.cwd()
owned = root / 'docs/implementation/qa/native-bridge'
snapshot = owned / 'runtime/android-snapshot'
assert not snapshot.exists(), 'Use a fresh QA runtime for an independent bridge.'
archive = subprocess.check_output(['git', 'archive', '--format=zip', 'HEAD', 'apps/android', 'packages/shared/tokens'])
with zipfile.ZipFile(io.BytesIO(archive)) as files:
    files.extractall(snapshot)
test = snapshot / 'apps/android/app/src/androidTest/java/app/fractal/reader/HubHttpBridgeTest.kt'
shutil.copyfile(owned / 'HubHttpBridgeTest.kt', test)
(snapshot / 'apps/android/local.properties').write_text('sdk.dir=C:/Users/Home/AppData/Local/Android/Sdk\n', encoding='utf-8')
print(snapshot)
