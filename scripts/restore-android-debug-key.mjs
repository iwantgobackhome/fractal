import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

// The coordinator supplies the original release key via Actions secrets.
// Never print or upload the key. A missing key fails rather than minting a new identity.
assert.ok(process.env.ANDROID_DEBUG_KEYSTORE_BASE64, 'Configure ANDROID_DEBUG_KEYSTORE_BASE64 for a stable Android update signature');
const bytes = Buffer.from(process.env.ANDROID_DEBUG_KEYSTORE_BASE64, 'base64');
assert.ok(bytes.length > 100, 'Configured Android keystore is empty or invalid');
const path = process.env.FRACTAL_ANDROID_KEYSTORE_PATH;
assert.ok(path && isAbsolute(path), 'Configure an explicit absolute FRACTAL_ANDROID_KEYSTORE_PATH');
const expected = process.env.EXPECT_ANDROID_CERT_SHA256?.replaceAll(':', '').toLowerCase();
assert.match(expected ?? '', /^[a-f0-9]{64}$/, 'Configure the previous public release certificate before restoring the key');
assert.ok(process.env.JAVA_HOME, 'JDK 17 JAVA_HOME is required for prebuild certificate verification');
await mkdir(dirname(path), { recursive: true, mode: 0o700 });
// Never replace a pre-existing key, including a user's default debug keystore.
await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
try {
  const keytool = join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
  const certificate = execFileSync(keytool, ['-exportcert', '-keystore', path, '-alias', 'androiddebugkey', '-storepass', 'android']);
  const actual = createHash('sha256').update(certificate).digest('hex');
  assert.equal(actual, expected, 'Restored key must preserve the previous public release certificate before building');
} catch (error) {
  await unlink(path); // Only the new file exclusively created by this invocation.
  throw error;
}
console.log('Stable Android debug key restored to explicit CI signing path; public certificate verified before build');
