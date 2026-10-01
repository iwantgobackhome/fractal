// electron-builder v26 configuration; every builder invocation uses --publish never.
const { build } = require('../package.json');
const signing = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const notarizing = signing && Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
module.exports = {
  ...build,
  // Both declared Linux targets are x64; their ${arch} macros otherwise become
  // x86_64 (AppImage) and amd64 (deb), breaking the published payload contract.
  linux: {
    ...build.linux,
    artifactName: 'Fractal-${version}-${os}-x64.${ext}',
  },
  mac: {
    ...build.mac,
    identity: signing ? undefined : '-',
    forceCodeSigning: signing,
    hardenedRuntime: signing,
    notarize: notarizing,
  },
};
