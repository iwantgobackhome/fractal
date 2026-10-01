"""Run the workflow's actual Bash credential guard without invoking a builder."""
from pathlib import Path
import os
import subprocess
import yaml

root = Path(__file__).resolve().parents[4]
workflow = yaml.load((root / '.github/workflows/release.yml').read_text(), Loader=yaml.BaseLoader)
step = next(step for step in workflow['jobs']['desktop']['steps'] if step.get('name', '').startswith('Package on native host'))
guard, invocation = step['run'].split('npx --no-install electron-builder', 1)
assert '--publish never' in invocation
assert "secrets.MAC_CSC_LINK != '' && secrets.MAC_CSC_KEY_PASSWORD != ''" in step['env']['CSC_IDENTITY_AUTO_DISCOVERY']
bash = r'C:\Program Files\Git\bin\bash.exe' if os.name == 'nt' else 'bash'
credentials = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
base = {key: value for key, value in os.environ.items() if key not in credentials + ['CSC_IDENTITY_AUTO_DISCOVERY']}
probe = """
node - <<'NODE'
const assert = require('node:assert/strict');
const signed = process.env.CHECK_SIGNING === '1';
const notarized = process.env.CHECK_NOTARIZING === '1';
for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD']) assert.equal(key in process.env, signed);
for (const key of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) assert.equal(key in process.env, notarized);
const config = require(process.cwd() + '/scripts/release-config.cjs');
assert.equal(config.mac.identity, signed ? undefined : '-');
assert.equal(config.mac.forceCodeSigning, signed);
assert.equal(config.mac.hardenedRuntime, signed);
assert.equal(config.mac.notarize, notarized);
NODE
"""
cases = [
    ('absent credentials', {}, False, False),
    ('incomplete certificate pair', {'CSC_LINK': 'synthetic-certificate'}, False, False),
    ('certificate pair only', {'CSC_LINK': 'synthetic-certificate', 'CSC_KEY_PASSWORD': 'synthetic-password'}, True, False),
    ('incomplete Apple credentials', {'CSC_LINK': 'synthetic-certificate', 'CSC_KEY_PASSWORD': 'synthetic-password', 'APPLE_ID': 'synthetic-apple-id'}, True, False),
    ('complete certificate and Apple credentials', {key: 'synthetic-' + key for key in credentials}, True, True),
]
for label, supplied, signed, notarized in cases:
    env = {**base, **dict.fromkeys(credentials, ''), **supplied,
           'CSC_IDENTITY_AUTO_DISCOVERY': str(signed).lower(),
           'CHECK_SIGNING': str(int(signed)), 'CHECK_NOTARIZING': str(int(notarized))}
    subprocess.run([bash, '--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', guard + probe], cwd=root, env=env, check=True)
    print('PASS workflow signing environment: ' + label)
