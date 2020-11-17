/* @flow */

import ROOT_USER from './root-user.js';

const path = require('path');

/**
 * 系统根目录
 */
export const home = require('os').homedir();

/**
 * 用户根目录
 */
const userHomeDir = ROOT_USER ? path.resolve('/usr/local/share') : home;

export default userHomeDir;
