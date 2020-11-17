/* @flow */

import type Config from './config.js';
import {normalizePattern} from './util/normalize-pattern.js';
import type {WorkspacesManifestMap, Manifest} from './types.js';

const semver = require('semver');

/**
 * workspace子项目package实例
 */
export default class WorkspaceLayout {
  constructor(workspaces: WorkspacesManifestMap, config: Config) {
    /**
     * 所有子项目package.json以及路经
     */
    this.workspaces = workspaces;
    /**
     * yarn配置config实例
     */
    this.config = config;
  }

  /**
   * 所有子项目package.json以及路经
   */
  workspaces: WorkspacesManifestMap;
  /**
   * yarn配置config实例
   */
  config: Config;
  /**
   * 和子项目拼接后的package.json的随机name
   */
  virtualManifestName: string;

  /**
   * 返回指定子项目的package.json以及路经
   * @param {*} key 
   */
  getWorkspaceManifest(key: string): {loc: string, manifest: Manifest} {
    return this.workspaces[key];
  }

  /**
   * 指定子项目+版本的package.json以及路经
   * @param {*} pattern 
   */
  getManifestByPattern(pattern: string): ?{loc: string, manifest: Manifest} {
    const {name, range} = normalizePattern(pattern);
    const workspace = this.getWorkspaceManifest(name);
    if (!workspace || !semver.satisfies(workspace.manifest.version, range, this.config.looseSemver)) {
      return null;
    }
    return workspace;
  }
}
