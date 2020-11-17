/* @flow */

import {readFileSync} from 'fs';
import * as path from 'path';
import {CONFIG_DIRECTORY} from '../constants';

const etc = '/etc';
/**
 * 是否为windows标志
 */
const isWin = process.platform === 'win32';
/**
 * 用户home目录
 */
const home = isWin ? process.env.USERPROFILE : process.env.HOME;

/**
 * 生成Rc文件可能存在的所有路经
 * @param {*} name rc源名
 * @param {*} cwd 当前项目路经
 */
function getRcPaths(name: string, cwd: string): Array<string> {
  const configPaths = [];

  function pushConfigPath(...segments) {
    configPaths.push(path.join(...segments));
    if (segments[segments.length - 1] === `.${name}rc`) {
      // 如果是以 .${}rc 结尾，则再加入一个以 .${}rc.yml 文件
      configPaths.push(path.join(...segments.slice(0, -1), `.${name}rc.yml`));
    }
  }

  function unshiftConfigPath(...segments) {
    if (segments[segments.length - 1] === `.${name}rc`) {
      // 如果是以 .${}rc 结尾，则在第一位加入一个以 .${}rc.yml 文件
      configPaths.unshift(path.join(...segments.slice(0, -1), `.${name}rc.yml`));
    }
    configPaths.unshift(path.join(...segments));
  }

  if (!isWin) {
    // 非windows环境从/etc/yarn/config开始查找
    pushConfigPath(etc, name, 'config');
    // 非windows环境从/etc/yarnrc开始查找
    pushConfigPath(etc, `${name}rc`);
  }

  // 存在用户目录
  if (home) {
    // yarn默认配置路经
    pushConfigPath(CONFIG_DIRECTORY);
    // 用户目录/.config/${name}/config
    pushConfigPath(home, '.config', name, 'config');
    // 用户目录/.config/${name}/config
    pushConfigPath(home, '.config', name);
    // 用户目录/.${name}/config
    pushConfigPath(home, `.${name}`, 'config');
    // 用户目录/.${name}rc
    pushConfigPath(home, `.${name}rc`);
  }

  // add .yarnrc locations relative to the cwd
  // 逐层向父级遍历加入.${name}rc路经
  // Tip: 用户主动写的rc文件优先级最高
  while (true) {
    // 插入 - 当前项目路经/.${name}rc
    unshiftConfigPath(cwd, `.${name}rc`);
    // 获取当前项目的父级路经
    const upperCwd = path.dirname(cwd);
    if (upperCwd === cwd) {
      // we've reached the root
      break;
    } else {
      // continue since there's still more directories to search
      cwd = upperCwd;
    }
  }

  const envVariable = `${name}_config`.toUpperCase();

  if (process.env[envVariable]) {
    // 如果环境变量有配置则加入相关路经
    pushConfigPath(process.env[envVariable]);
  }

  return configPaths;
}

/**
 * 遍历所有可能存在rc文件的路经
 * @param {*} paths 所有可能存在rc文件的路经集合
 * @param {*} parser 回调
 */
function parseRcPaths(paths: Array<string>, parser: Function): Object {
  return Object.assign(
    {},
    ...paths.map(path => {
      try {
        return parser(readFileSync(path).toString(), path);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR') {
          return {};
        } else {
          throw error;
        }
      }
    }),
  );
}

/**
 * 查找.${name}rc文件
 * @param {*} name 源名 yarn
 * @param {*} cwd 当前项目路经
 * @param {*} parser 文件解析回调
 */
export function findRc(name: string, cwd: string, parser: Function): Object {
  return parseRcPaths(getRcPaths(name, cwd), parser);
}
