"""Focused signing restore checks with a disposable synthetic key, never a user key.

Pass --gradle for a configuration-only Gradle help task proving the debug binding.
No APK is built, and all test key/placeholder files are removed on exit.
"""
from pathlib import Path
import hashlib
import os
import subprocess
import sys
import tempfile
import base64

root = Path(__file__).resolve().parents[4]
jdk = Path(os.environ.get('FRACTAL_TEST_JAVA_HOME') or os.environ.get('JAVA_HOME', r'C:\Program Files\Java\jdk-17.0.2'))
keytool = jdk / 'bin' / ('keytool.exe' if os.name == 'nt' else 'keytool')
base = {key: value for key, value in os.environ.items() if key not in ['ANDROID_DEBUG_KEYSTORE_BASE64', 'FRACTAL_ANDROID_KEYSTORE_PATH', 'EXPECT_ANDROID_CERT_SHA256']}
base['JAVA_HOME'] = str(jdk)
(root / 'dist').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='android-signing-review-', dir=root / 'dist') as temporary:
    directory = Path(temporary)
    synthetic = directory / 'synthetic.keystore'
    subprocess.run([str(keytool), '-genkeypair', '-alias', 'androiddebugkey', '-keystore', str(synthetic), '-storetype', 'PKCS12', '-storepass', 'android', '-keypass', 'android', '-keyalg', 'RSA', '-validity', '1', '-dname', 'CN=Android Debug,O=Disposable Test,C=US'], env=base, check=True, capture_output=True)
    certificate = subprocess.run([str(keytool), '-exportcert', '-alias', 'androiddebugkey', '-keystore', str(synthetic), '-storepass', 'android'], env=base, check=True, capture_output=True).stdout
    encoded = base64.b64encode(synthetic.read_bytes()).decode('ascii')
    target = directory / 'restored' / 'debug.keystore'
    env = {**base, 'ANDROID_DEBUG_KEYSTORE_BASE64': encoded, 'FRACTAL_ANDROID_KEYSTORE_PATH': str(target), 'EXPECT_ANDROID_CERT_SHA256': hashlib.sha256(certificate).hexdigest()}
    command = ['node', 'scripts/restore-android-debug-key.mjs']
    subprocess.run(command, cwd=root, env=env, check=True, capture_output=True)
    assert target.read_bytes() == synthetic.read_bytes()
    print('PASS actual restore: explicit path and real JDK public-certificate match')
    target.unlink()
    mismatch = subprocess.run(command, cwd=root, env={**env, 'EXPECT_ANDROID_CERT_SHA256': '0' * 64}, capture_output=True)
    assert mismatch.returncode != 0 and not target.exists()
    print('PASS certificate mismatch fails before build and removes only its newly created key')
    target.write_bytes(b'pre-existing-key-preserved')
    existing = subprocess.run(command, cwd=root, env=env, capture_output=True)
    assert existing.returncode != 0 and target.read_bytes() == b'pre-existing-key-preserved'
    print('PASS pre-existing key is never overwritten or removed')
    target.unlink()
    missing = subprocess.run(command, cwd=root, env={**env, 'EXPECT_ANDROID_CERT_SHA256': ''}, capture_output=True)
    assert missing.returncode != 0 and not target.exists()
    print('PASS missing expected public certificate fails before key write')
    if '--gradle' in sys.argv:
        # A placeholder proves path binding; Gradle help never reads/signs a key.
        target.write_bytes(b'configuration-only-placeholder')
        init = directory / 'binding.gradle'
        init.write_text("""gradle.projectsEvaluated {
    def app = gradle.rootProject.findProject(':app')
    def android = app.extensions.getByName('android')
    def expected = new File(System.getenv('FRACTAL_ANDROID_KEYSTORE_PATH')).canonicalFile
    assert android.signingConfigs.getByName('debug').storeFile.canonicalFile == expected
    assert android.buildTypes.getByName('debug').signingConfig.storeFile.canonicalFile == expected
    println 'PASS actual Gradle debug variant uses the explicit verified CI store path'
}
""", encoding='utf-8')
        env = {**base, 'GITHUB_ACTIONS': 'true', 'FRACTAL_ANDROID_KEYSTORE_PATH': str(target)}
        if not env.get('ANDROID_HOME') and os.name == 'nt':
            env['ANDROID_HOME'] = str(Path(os.environ['LOCALAPPDATA']) / 'Android' / 'Sdk')
        wrapper = 'gradlew.bat' if os.name == 'nt' else './gradlew'
        subprocess.run([str(root / 'apps/android' / wrapper), '--offline', '--no-daemon', '-I', str(init), 'help'], cwd=root / 'apps/android', env=env, check=True)
print('PASS disposable signing review directory removed; no user key or APK touched')
