// electron-builder v26 configuration; every builder invocation uses --publish never.
const { build } = require('../package.json');
const signing = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const notarizing = signing && Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
module.exports = {
  ...build,
  ...require('./preserve-electron-licenses.cjs'),
  publish: { provider: 'github', owner: 'iwantgobackhome', repo: 'news-papers' },
  // AppImage embeds its differential map; retain an external map in the release
  // contract too, without modifying the already hashed installer.
  afterAllArtifactBuild: async ({ artifactPaths }) => {
    const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');
    const maps = [];
    for (const file of artifactPaths.filter((path) => path.endsWith('.AppImage'))) {
      const output = `${file}.blockmap`;
      await buildBlockMap(file, 'gzip', output);
      maps.push(output);
    }
    return maps;
  },
  // Both declared Linux targets are x64; their ${arch} macros otherwise become
  // x86_64 (AppImage) and amd64 (deb), breaking the published payload contract.
  linux: {
    ...build.linux,
    artifactName: 'News-Papers-${version}-${os}-x64.${ext}',
  },
  mac: {
    ...build.mac,
    identity: signing ? undefined : '-',
    forceCodeSigning: signing,
    hardenedRuntime: signing,
    notarize: notarizing,
  },
};
