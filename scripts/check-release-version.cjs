const version = require('../package.json').version;
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match package.json version v${version}`);
}
