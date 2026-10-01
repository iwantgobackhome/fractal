import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The coordinator supplies the original release key via Actions secrets.
// Never print or upload the key. A missing key fails rather than minting a new identity.
assert.ok(process.env.ANDROID_DEBUG_KEYSTORE_BASE64, 'Configure ANDROID_DEBUG_KEYSTORE_BASE64 for a stable Android update signature');
const bytes = Buffer.from(process.env.ANDROID_DEBUG_KEYSTORE_BASE64, 'base64');
assert.ok(bytes.length > 100, 'Configured Android keystore is empty or invalid');
const directory = join(homedir(), '.android');
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'debug.keystore'), bytes, { mode: 0o600 });
console.log('Stable Android debug signing key restored from configured secret');
