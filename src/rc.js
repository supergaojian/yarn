/* @flow */

import {existsSync, readFileSync} from 'fs';
import {dirname, resolve} from 'path';

import commander from 'commander';

import {parse} from './lockfile';
import * as rcUtil from './util/rc.js';

// Keys that will get resolved relative to the path of the rc file they belong to
const PATH_KEYS = new Set([
  'yarn-path',
  'cache-folder',
  'global-folder',
  'modules-folder',
  'cwd',
  'offline-cache-folder',
]);

// given a cwd, load all .yarnrc files relative to it
/**
 * 从当前项目路经中获取rc配置
 * @param {string} cwd 当前项目路经
 * @param {string[]} args 用户cli参数
 */
export function getRcConfigForCwd(cwd: string, args: Array<string>): {[key: string]: string} {
  const config = {};

  if (args.indexOf('--no-default-rc') === -1) {
    // 如果用户没有指定不使用默认rc文件
    // 则遍历整条链路下的所有 .yarnrc 文件
    Object.assign(
      config,
      rcUtil.findRc('yarn', cwd, (fileText, filePath) => {
        return loadRcFile(fileText, filePath);
      }),
    );
  }

  // 如果用户配置了 --use-yarnrc 则取下一个参数读取对应的配置文件
  for (let index = args.indexOf('--use-yarnrc'); index !== -1; index = args.indexOf('--use-yarnrc', index + 1)) {
    const value = args[index + 1];

    // 以 - 开头会认为是yarn参数
    if (value && value.charAt(0) !== '-') {
      Object.assign(config, loadRcFile(readFileSync(value, 'utf8'), value));
    }
  }

  return config;
}

export function getRcConfigForFolder(cwd: string): {[key: string]: string} {
  const filePath = resolve(cwd, '.yarnrc');
  if (!existsSync(filePath)) {
    return {};
  }

  const fileText = readFileSync(filePath, 'utf8');
  return loadRcFile(fileText, filePath);
}

/**
 * 读取rc文件
 * @param {*} fileText 文件内容字符串
 * @param {*} filePath 文件路经
 */
function loadRcFile(fileText: string, filePath: string): {[key: string]: string} {
  let {object: values} = parse(fileText, filePath);

  if (filePath.match(/\.yml$/) && typeof values.yarnPath === 'string') {
    // yml 文件
    values = {'yarn-path': values.yarnPath};
  }

  // some keys reference directories so keep their relativity
  for (const key in values) {
    if (PATH_KEYS.has(key.replace(/^(--)?([^.]+\.)*/, ''))) {
      values[key] = resolve(dirname(filePath), values[key]);
    }
  }

  return values;
}

// get the built of arguments of a .yarnrc chain of the passed cwd
function buildRcArgs(cwd: string, args: Array<string>): Map<string, Array<string>> {
  const config = getRcConfigForCwd(cwd, args);

  const argsForCommands: Map<string, Array<string>> = new Map();

  for (const key in config) {
    // args can be prefixed with the command name they're meant for, eg.
    // `--install.check-files true`
    const keyMatch = key.match(/^--(?:([^.]+)\.)?(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const commandName = keyMatch[1] || '*';
    const arg = keyMatch[2];
    const value = config[key];

    // create args for this command name if we didn't previously have them
    const args = argsForCommands.get(commandName) || [];
    argsForCommands.set(commandName, args);

    // turn config value into appropriate cli flag
    const option = commander.optionFor(`--${arg}`);

    // If commander doesn't recognize the option or it takes a value after it
    if (!option || option.optional || option.required) {
      args.push(`--${arg}`, value);
    } else if (value === true) {
      // we can't force remove an arg from cli
      args.push(`--${arg}`);
    }
  }

  return argsForCommands;
}

// extract the value of a --cwd arg if present
function extractCwdArg(args: Array<string>): ?string {
  for (let i = 0, I = args.length; i < I; ++i) {
    const arg = args[i];
    if (arg === '--') {
      return null;
    } else if (arg === '--cwd') {
      return args[i + 1];
    }
  }
  return null;
}

// get a list of arguments from .yarnrc that apply to this commandName
export function getRcArgs(commandName: string, args: Array<string>, previousCwds?: Array<string> = []): Array<string> {
  // for the cwd, use the --cwd arg if it was passed or else use process.cwd()
  const origCwd = extractCwdArg(args) || process.cwd();

  // get a map of command names and their arguments
  const argMap = buildRcArgs(origCwd, args);

  // concat wildcard arguments and arguments meant for this specific command
  const newArgs = [...(argMap.get('*') || []), ...(argMap.get(commandName) || [])];

  // check if the .yarnrc args specified a cwd
  const newCwd = extractCwdArg(newArgs);
  if (newCwd && newCwd !== origCwd) {
    // ensure that we don't enter into a loop
    if (previousCwds.indexOf(newCwd) !== -1) {
      throw new Error(`Recursive .yarnrc files specifying --cwd flags. Bailing out.`);
    }

    //  if we have a new cwd then let's refetch the .yarnrc args relative to it
    return getRcArgs(commandName, newArgs, previousCwds.concat(origCwd));
  }

  return newArgs;
}
