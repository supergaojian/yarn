/* @flow */

import type PackageRequest from '../../package-request.js';
import type {RegistryNames} from '../../registries/index.js';
import BaseResolver from '../base-resolver.js';

export default class RegistryResolver extends BaseResolver {
  constructor(request: PackageRequest, name: string, range: string) {
    super(request, `${name}@${range}`);
    /**
     * 依赖包名
     */
    this.name = name;
    /**
     * 版本号
     */
    this.range = range;

    this.registryConfig = request.config.registries[this.constructor.registry].config;
  }

  name: string;
  range: string;

  static registry: RegistryNames;
  registryConfig: Object;
}
