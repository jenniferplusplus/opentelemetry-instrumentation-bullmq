import path from 'node:path';

const packageJsonUrl = path.resolve(`${module.path}/../package.json`);
const pjson = require(packageJsonUrl);

export const VERSION = pjson.version;
