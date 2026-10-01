// electron-builder v26 configuration; every builder invocation uses --publish never.
const { build } = require('../package.json');
const signing = Boolean(process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD);
const notarizing = signing && Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);
module.exports = {
  ...build,
  mac: {
    ...build.mac,
    identity: signing ? undefined : '-',
    forceCodeSigning: signing,
    hardenedRuntime: signing,
    notarize: notarizing,
  },
};
