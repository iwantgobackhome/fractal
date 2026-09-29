import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../packages/hub/src/main';
import { systemAddresses } from '../packages/hub/src/net/index';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const directory = mkdtempSync(join(tmpdir(), 'fractal-w1d-manual-'));
const addresses = await systemAddresses();
const ip = addresses.lan.at(-1);
if (!ip) throw new Error('No LAN IPv4 address available');
const service = await startService({ dataDirectory: directory, port: 17328, log: () => {} });
try {
  const network = await service.network.update({ lan: true, tailscale: false });
  const start = await fetch(`${service.url}/api/pairing/start`, {
    method: 'POST',
    headers: { origin: service.url, 'x-paperread-token': service.token, 'content-type': 'application/json' },
    body: '{}',
  });
  const started = ((await start.json()) as { data: { payload: { code: string } } }).data;
  const remote = `http://${ip}:17328`;
  const without = await fetch(`${remote}/api/papers`);
  const claim = await fetch(`${remote}/api/pairing/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: started.payload.code, name: 'Manual phone', platform: 'Android' }),
  });
  const claimed = ((await claim.json()) as { data: { deviceToken: string } }).data;
  const withToken = await fetch(`${remote}/api/papers`, { headers: { authorization: `Bearer ${claimed.deviceToken}` } });
  const staticWithout = await fetch(`${remote}/`);
  const ping = await fetch(`${remote}/api/hub/ping`);
  const curlWithout = (
    await execFileAsync('curl.exe', ['--noproxy', '*', '--max-time', '5', '-sS', '-w', '\nHTTP %{http_code}', `${remote}/api/papers`], { encoding: 'utf8' })
  ).stdout;
  const curlWith = (
    await execFileAsync(
      'curl.exe',
      ['--noproxy', '*', '--max-time', '5', '-sS', '-w', '\nHTTP %{http_code}', '-H', `Authorization: Bearer ${claimed.deviceToken}`, `${remote}/api/papers`],
      { encoding: 'utf8' },
    )
  ).stdout;
  console.log(
    JSON.stringify(
      {
        ip,
        network,
        withoutToken: { status: without.status, body: await without.json() },
        claim: { status: claim.status, tokenBytes: claimed.deviceToken.length / 2 },
        withToken: { status: withToken.status, body: await withToken.json() },
        staticWithoutToken: staticWithout.status,
        ping: { status: ping.status, body: await ping.json() },
        curlWithout,
        curlWith,
      },
      null,
      2,
    ),
  );
} finally {
  await service.stop();
  rmSync(directory, { recursive: true, force: true });
}
