import path from 'node:path';

const packageJsonUrl = path.resolve(`${module.path}/../package.json`);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkgJSON = require(packageJsonUrl);

export const VERSION = pkgJSON.version;
