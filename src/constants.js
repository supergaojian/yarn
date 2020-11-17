/* @flow */

const os = require('os');
const path = require('path');
const userHome = require('./util/user-home-dir').default;
const {getCacheDir, getConfigDir, getDataDir} = require('./util/user-dirs');
const isWebpackBundle = require('is-webpack-bundle');

type Env = {
  [key: string]: ?string,
};

/**
 * 依赖字段集合
 */
export const DEPENDENCY_TYPES = ['devDependencies', 'dependencies', 'optionalDependencies', 'peerDependencies'];
/**
 * 依赖字段
 */
export const OWNED_DEPENDENCY_TYPES = ['devDependencies', 'dependencies', 'optionalDependencies'];

export const RESOLUTIONS = 'resolutions';
export const MANIFEST_FIELDS = [RESOLUTIONS, ...DEPENDENCY_TYPES];

/**
 * 推荐nodejs版本
 */
export const SUPPORTED_NODE_VERSIONS = '^4.8.0 || ^5.7.0 || ^6.2.2 || >=8.0.0';

/**
 * yarn仓库地址
 */
export const YARN_REGISTRY = 'https://registry.yarnpkg.com';
/**
 * npm仓库地址正则表达式
 */
export const NPM_REGISTRY_RE = /https?:\/\/registry\.npmjs\.org/g;

export const YARN_DOCS = 'https://yarnpkg.com/en/docs/cli/';
export const YARN_INSTALLER_SH = 'https://yarnpkg.com/install.sh';
export const YARN_INSTALLER_MSI = 'https://yarnpkg.com/latest.msi';

/**
 * yarn仓库最新版本地址
 */
export const SELF_UPDATE_VERSION_URL = 'https://yarnpkg.com/latest-version';

// cache version, bump whenever we make backwards incompatible changes
export const CACHE_VERSION = 6;

// lockfile version, bump whenever we make backwards incompatible changes
export const LOCKFILE_VERSION = 1;

// max amount of network requests to perform concurrently
/**
 * 默认并发执行的最大网络请求数
 */
export const NETWORK_CONCURRENCY = 8;

// HTTP timeout used when downloading packages
/**
 * 默认下载软件包时使用的HTTP超时 30秒（毫秒）
 */
export const NETWORK_TIMEOUT = 30 * 1000; // in milliseconds

// max amount of child processes to execute concurrently
/**
 * 默认可同时执行的最大子进程数量
 */
export const CHILD_CONCURRENCY = 5;

export const REQUIRED_PACKAGE_KEYS = ['name', 'version', '_uid'];

function getPreferredCacheDirectories(): Array<string> {
  const preferredCacheDirectories = [getCacheDir()];

  if (process.getuid) {
    // $FlowFixMe: process.getuid exists, dammit
    preferredCacheDirectories.push(path.join(os.tmpdir(), `.yarn-cache-${process.getuid()}`));
  }

  preferredCacheDirectories.push(path.join(os.tmpdir(), `.yarn-cache`));

  return preferredCacheDirectories;
}

/**
 * 首选模块缓存目录
 */
export const PREFERRED_MODULE_CACHE_DIRECTORIES = getPreferredCacheDirectories();
/**
 * yarn配置文件目录
 */
export const CONFIG_DIRECTORY = getConfigDir();
export const DATA_DIRECTORY = getDataDir();
/**
 * yarn link默认目录
 */
export const LINK_REGISTRY_DIRECTORY = path.join(DATA_DIRECTORY, 'link');
/**
 * yarn global默认目录
 */
export const GLOBAL_MODULE_DIRECTORY = path.join(DATA_DIRECTORY, 'global');

export const NODE_BIN_PATH = process.execPath;
export const YARN_BIN_PATH = getYarnBinPath();

// Webpack needs to be configured with node.__dirname/__filename = false
function getYarnBinPath(): string {
  if (isWebpackBundle) {
    return __filename;
  } else {
    return path.join(__dirname, '..', 'bin', 'yarn.js');
  }
}

/**
 * node_modules文件名
 */
export const NODE_MODULES_FOLDER = 'node_modules';
/**
 * package.json路经
 */
export const NODE_PACKAGE_JSON = 'package.json';

export const PNP_FILENAME = '.pnp.js';

export const POSIX_GLOBAL_PREFIX = `${process.env.DESTDIR || ''}/usr/local`;
export const FALLBACK_GLOBAL_PREFIX = path.join(userHome, '.yarn');

export const META_FOLDER = '.yarn-meta';
export const INTEGRITY_FILENAME = '.yarn-integrity';
/**
 * yarn-lock文件名
 */
export const LOCKFILE_FILENAME = 'yarn.lock';
export const METADATA_FILENAME = '.yarn-metadata.json';
export const TARBALL_FILENAME = '.yarn-tarball.tgz';
export const CLEAN_FILENAME = '.yarnclean';

/**
 * npm-lock文件名
 */
export const NPM_LOCK_FILENAME = 'package-lock.json';
export const NPM_SHRINKWRAP_FILENAME = 'npm-shrinkwrap.json';

export const DEFAULT_INDENT = '  ';
export const SINGLE_INSTANCE_PORT = 31997;
export const SINGLE_INSTANCE_FILENAME = '.yarn-single-instance';

export const ENV_PATH_KEY = getPathKey(process.platform, process.env);

export function getPathKey(platform: string, env: Env): string {
  let pathKey = 'PATH';

  // windows calls its path "Path" usually, but this is not guaranteed.
  if (platform === 'win32') {
    pathKey = 'Path';

    for (const key in env) {
      if (key.toLowerCase() === 'path') {
        pathKey = key;
      }
    }
  }

  return pathKey;
}

export const VERSION_COLOR_SCHEME: {[key: string]: VersionColor} = {
  major: 'red',
  premajor: 'red',
  minor: 'yellow',
  preminor: 'yellow',
  patch: 'green',
  prepatch: 'green',
  prerelease: 'red',
  unchanged: 'white',
  unknown: 'red',
};

export type VersionColor = 'red' | 'yellow' | 'green' | 'white';

export type RequestHint = 'dev' | 'optional' | 'resolution' | 'workspaces';
