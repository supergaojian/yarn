/* @flow */

import type {Reporter} from './reporters/index.js';
import type Config from './config.js';

const semver = require('semver');

// This isn't really a "proper" constraint resolver. We just return the highest semver
// version in the versions passed that satisfies the input range. This vastly reduces
// the complexity and is very efficient for package resolution.

/**
 * package包版本约束
 */
export default class PackageConstraintResolver {
  constructor(config: Config, reporter: Reporter) {
    this.reporter = reporter;
    this.config = config;
  }

  /**
   * 日志实例
   */
  reporter: Reporter;

  /**
   * config实例
   */
  config: Config;

  /**
   * 返回最大版本号
   * @param {*} versions 有效版本
   * @param {*} range 指定版本范围
   */
  reduce(versions: Array<string>, range: string): Promise<?string> {
    if (range === 'latest') {
      // Usually versions are already ordered and the last one is the latest
      // 如果版本范围使用'latext'则使用最后一个有效版本
      return Promise.resolve(versions[versions.length - 1]);
    } else {
      // 其它场景取最大的版本号
      return Promise.resolve(semver.maxSatisfying(versions, range, this.config.looseSemver));
    }
  }
}
