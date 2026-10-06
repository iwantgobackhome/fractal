import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Traverse only production/optional edges from the shipped root, hub and UI.
// This conservatively includes tree-shaken dependencies and optional platform
// packages, covering inlined hub/UI code, workers, fonts and native modules.
export function productionPackages(lock, roots = ['', 'packages/hub', 'packages/ui']) {
  const seen = new Set();
  function resolve(from, name) {
    let directory = from;
    while (true) {
      const candidate = path.posix.join(directory, 'node_modules', name);
      if (lock.packages[candidate]) return candidate;
      if (!directory) return undefined;
      directory = path.posix.dirname(directory);
      if (directory === '.') directory = '';
    }
  }
  function visit(key) {
    if (seen.has(key)) return;
    seen.add(key);
    let pkg = lock.packages[key];
    if (pkg?.link) {
      visit(pkg.resolved);
      return;
    }
    for (const name of Object.keys({ ...pkg?.dependencies, ...pkg?.optionalDependencies, ...pkg?.peerDependencies })) {
      const target = resolve(key, name);
      if (target) visit(target);
    }
  }
  roots.forEach(visit);
  return [...seen].filter((key) => key.includes('node_modules/') && !lock.packages[key].link).sort();
}
export function formatLicenses(packages) {
  const unique = new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg]));
  return [...unique.values()]
    .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
    .map(
      (pkg) =>
        `${pkg.name}@${pkg.version}\nLicense: ${pkg.license || 'Not specified'}\nRepository: ${typeof pkg.repository === 'object' ? pkg.repository.url : pkg.repository || 'Not specified'}\n\n${pkg.text || 'No license text included in the installed package; consult its repository.'}\n`,
    )
    .join('\n' + '='.repeat(80) + '\n\n');
}
export async function generate(root = process.cwd()) {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const packages = [];
  for (const key of productionPackages(lock)) {
    const directory = path.join(root, key);
    const entry = lock.packages[key];
    let pkg;
    try {
      pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' || !(entry.os || entry.cpu || entry.optional)) throw error;
      pkg = { ...entry, name: key.split('node_modules/').at(-1) };
    }
    const texts = [];
    for (const file of await readdir(directory).catch(() => [])) {
      if (/^(licen[sc]e|copying|notice|ofl)([._-].*)?$/i.test(file)) {
        try {
          texts.push(`${file}\n${await readFile(path.join(directory, file), 'utf8')}`);
        } catch (error) {
          if (error.code !== 'EISDIR') throw error;
        }
      }
    }
    // Pretendard's npm tarball omits its OFL text; preserve the exact tagged
    // upstream notice checked in with this generator. No network at build time.
    if (pkg.name === 'pretendard' && pkg.version === '1.3.9') texts.push(await readFile(path.join(root, 'scripts/license-texts/pretendard-1.3.9.txt'), 'utf8'));
    if (pkg.name === '@fontsource-variable/source-serif-4') texts.push(await readFile(path.join(root, 'scripts/license-texts/source-serif-4.txt'), 'utf8'));
    packages.push({ ...pkg, text: texts.join('\n\n') });
  }
  const output = path.join(root, 'dist/licenses');
  await mkdir(output, { recursive: true });
  await writeFile(
    path.join(output, 'desktop-third-party.txt'),
    'News Papers — third-party npm licenses\nGenerated from package-lock.json production, optional and installed peer dependency closure of root, hub and UI. Includes conservatively tree-shaken and platform-specific packages. Electron and Chromium license notices are preserved from the target Electron distribution in resources/licenses/LICENSE.electron.txt and LICENSES.chromium.html.\n\n' +
      formatLicenses(packages),
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generate();
