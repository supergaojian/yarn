/* @flow */

import http from 'http';
import net from 'net';
import path from 'path';

import commander from 'commander';
import fs from 'fs';
import invariant from 'invariant';
import lockfile from 'proper-lockfile';
import loudRejection from 'loud-rejection';
import onDeath from 'death';
import semver from 'semver';

import {ConsoleReporter, JSONReporter} from '../reporters/index.js';
import {registries, registryNames} from '../registries/index.js';
import commands from './commands/index.js';
import * as constants from '../constants.js';
import * as network from '../util/network.js';
import {MessageError} from '../errors.js';
import Config from '../config.js';
import {getRcConfigForCwd, getRcArgs} from '../rc.js';
import {spawnp, forkp} from '../util/child.js';
import {version} from '../util/yarn-version.js';
import handleSignals from '../util/signal-handler.js';
import {boolify, boolifyWithDefault} from '../util/conversion.js';
import {ProcessTermError} from '../errors';

/******************************************** yarn执行入口 *****************************************************/

/**
 * TODO 临时global日志用于调试
 */
global.log = (...args) => {
  let exit = true;
  if (args.length > 1 && typeof args[args.length - 1] === 'boolean' && !args[args.length - 1]) {
    exit = false;
    args.pop();
  }

  console.log('----------------------------------------------------------')
  args.forEach((arg, idx) => {
    console.log(arg)
  });
  console.log('----------------------------------------------------------')
  if (typeof exit === 'boolean' && exit === true) {
    process.exit();
  }
}

/**
 * 在error消息最开头插入监听
 */
process.stdout.prependListener('error', err => {
  // swallow err only if downstream consumer process closed pipe early
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    return;
  }
  throw err;
});

/**
 * 向父级逐级找package.json所在的目录
 * @param {string} base 目录
 */
function findProjectRoot(base: string): string {
  let prev = null;
  let dir = base;

  do {
    if (fs.existsSync(path.join(dir, constants.NODE_PACKAGE_JSON))) {
      return dir;
    }

    prev = dir;
    dir = path.dirname(dir);
  } while (dir !== prev);

  return base;
}

/**
 * 执行cli命令
 * @param {*} param0 
 */
export async function main({
  startArgs,
  args,
  endArgs,
}: {
  /**
   * cli命令
   */
  startArgs: Array<string>,
  /**
   * 子命令 & 参数
   */
  args: Array<string>,
  /**
   * --之后的参数
   */
  endArgs: Array<string>,
}): Promise<void> {
  const collect = (val, acc) => {
    acc.push(val);
    return acc;
  };

  loudRejection();
  // 增加监听 SIGTERM 事件关闭全部子进程
  handleSignals();

  // set global options
  // 当前 yarn 版本号
  commander.version(version, '-v, --version');
  commander.usage('[command] [flags]');
  // 禁止 Yarn 自动检测 yarnrc 和 npmrc 文件
  commander.option('--no-default-rc', 'prevent Yarn from automatically detecting yarnrc and npmrc files');
  // 指定Yarn应该使用的yarnrc文件（仅.yarnrc，而不是.npmrc）
  commander.option(
    '--use-yarnrc <path>',
    'specifies a yarnrc file that Yarn should use (.yarnrc only, not .npmrc)',
    collect,
    [],
  );
  // 在内部操作上输出详细消息
  commander.option('--verbose', 'output verbose messages on internal operations');
  // 如果本地高速缓存中没有任何必需的依赖项，则会触发错误
  commander.option('--offline', 'trigger an error if any required dependencies are not available in local cache');
  // 仅当本地缓存中不存在依赖项时才使用网络
  commander.option('--prefer-offline', 'use network only if dependencies are not available in local cache');
  // 启用即插即用安装
  commander.option('--enable-pnp, --pnp', "enable the Plug'n'Play installation");
  // 禁用即插即用安装
  commander.option('--disable-pnp', "disable the Plug'n'Play installation");
  // 严格版本号匹配
  commander.option('--strict-semver');
  // 将Yarn日志消息格式化为JSON行（请参阅jsonlines.org）
  commander.option('--json', 'format Yarn log messages as lines of JSON (see jsonlines.org)');
  // 忽略执行生命周期钩子
  commander.option('--ignore-scripts', "don't run lifecycle scripts");
  // 保存网络流量的HAR输出
  commander.option('--har', 'save HAR output of network traffic');
  // 忽略平台检查
  commander.option('--ignore-platform', 'ignore platform checks');
  // 忽略引擎检查
  commander.option('--ignore-engines', 'ignore engines check');
  // 忽略optional dependencies
  commander.option('--ignore-optional', 'ignore optional dependencies');
  // 即使已构建软件包，也要安装并构建软件包，覆盖yarn.lock
  commander.option('--force', 'install and build packages even if they were built before, overwrite lockfile');
  // 运行安装而不检查是否安装了node_modules
  commander.option('--skip-integrity-check', 'run install without checking if node_modules is installed');
  // 安装将验证软件包文件树的一致性
  commander.option('--check-files', 'install will verify file tree of packages for consistency');
  // 设置程序包时不生成bin链接
  commander.option('--no-bin-links', "don't generate bin links when setting up packages");
  // 只允许一个版本的软件包
  commander.option('--flat', 'only allow one version of a package');
  // production环境
  commander.option('--prod, --production [prod]', '', boolify);
  // 不读取或生成yarn.lock
  commander.option('--no-lockfile', "don't read or generate a lockfile");
  // 不生成yarn.lock
  commander.option('--pure-lockfile', "don't generate a lockfile");
  // 不生成yarn.lock，如果需要更新则失败
  commander.option('--frozen-lockfile', "don't generate a lockfile and fail if an update is needed");
  // 从当前存储库更新程序包校验
  commander.option('--update-checksums', 'update package checksums from current repository');
  // 创建到node_modules中重复模块的硬链接
  commander.option('--link-duplicates', 'create hardlinks to the repeated modules in node_modules');
  // 指定一个自定义文件夹来存储全局链接
  commander.option('--link-folder <path>', 'specify a custom folder to store global links');
  // 指定一个自定义文件夹来存储全局包
  commander.option('--global-folder <path>', 'specify a custom folder to store global packages');
  // 不是将模块安装到相对于cwd的node_modules文件夹中，请在此处输出它们
  commander.option(
    '--modules-folder <path>',
    'rather than installing modules into the node_modules folder relative to the cwd, output them here',
  );
  // 指定一个自定义文件夹以存储yarn缓存
  commander.option('--preferred-cache-folder <path>', 'specify a custom folder to store the yarn cache if possible');
  // 指定必须用于存储yarn缓存的自定义文件夹
  commander.option('--cache-folder <path>', 'specify a custom folder that must be used to store the yarn cache');
  // 使用互斥量以确保仅执行一个yarn实例
  commander.option('--mutex <type>[:specifier]', 'use a mutex to ensure only one yarn instance is executing');
  // 允许emoji表情
  commander.option(
    '--emoji [bool]',
    'enable emoji in output',
    boolify,
    process.platform === 'darwin' ||
      process.env.TERM_PROGRAM === 'Hyper' ||
      process.env.TERM_PROGRAM === 'HyperTerm' ||
      process.env.TERM_PROGRAM === 'Terminus',
  );
  // 跳过Yarn控制台日志，将打印其他类型的日志（脚本输出）
  commander.option('-s, --silent', 'skip Yarn console logs, other types of logs (script output) will be printed');
  // 输出使用的工作目录
  commander.option('--cwd <cwd>', 'working directory to use', process.cwd());
  // 使用代理地址
  commander.option('--proxy <host>', '');
  // 使用https代理地址
  commander.option('--https-proxy <host>', '');
  // 覆盖配置的npm仓库地址
  commander.option('--registry <url>', 'override configuration registry');
  // 不展示进度条
  commander.option('--no-progress', 'disable progress bar');
  // 并发网络请求的最大数量
  commander.option('--network-concurrency <number>', 'maximum number of concurrent network requests', parseInt);
  // 网络请求的TCP超时
  commander.option('--network-timeout <milliseconds>', 'TCP timeout for network requests', parseInt);
  // 不显示交互提示
  commander.option('--non-interactive', 'do not show interactive prompts');
  // 在脚本中将节点可执行文件目录添加到PATH
  commander.option(
    '--scripts-prepend-node-path [bool]',
    'prepend the node executable dir to the PATH in scripts',
    boolify,
  );
  // 使用可能不受支持的node版本时不发出警告
  commander.option('--no-node-version-check', 'do not warn when using a potentially unsupported Node version');
  // 通过安装其兄弟workspace的远程副本来专注于单个workspace
  commander.option('--focus', 'Focus on a single workspace by installing remote copies of its sibling workspaces.');
  // 一次性密码进行两因素验证
  commander.option('--otp <otpcode>', 'one-time password for two factor authentication');

  // if -v is the first command, then always exit after returning the version
  if (args[0] === '-v') {
    // -v 返回当前yarn版本
    process.exitCode = 0;
    return;
  }

  // get command name
  /**
   * yarn子命令索引
   */
  const firstNonFlagIndex = args.findIndex((arg, idx, arr) => {
    // 默认认为 - 开头都是配置项
    const isOption = arg.startsWith('-');
    // 取前一个元素
    const prev = idx > 0 && arr[idx - 1];
    const prevOption = prev && prev.startsWith('-') && commander.optionFor(prev);
    const boundToPrevOption = prevOption && (prevOption.optional || prevOption.required);

    return !isOption && !boundToPrevOption;
  });

  let preCommandArgs;
  let commandName = '';
  if (firstNonFlagIndex > -1) {
    preCommandArgs = args.slice(0, firstNonFlagIndex);
    commandName = args[firstNonFlagIndex];
    args = args.slice(firstNonFlagIndex + 1);
  } else {
    preCommandArgs = args;
    args = [];
  }

  // ----- 帮助相关 -----
  let isKnownCommand = Object.prototype.hasOwnProperty.call(commands, commandName);
  const isHelp = arg => arg === '--help' || arg === '-h';
  const helpInPre = preCommandArgs.findIndex(isHelp);
  const helpInArgs = args.findIndex(isHelp);
  const setHelpMode = () => {
    if (isKnownCommand) {
      args.unshift(commandName);
    }
    commandName = 'help';
    isKnownCommand = true;
  };

  if (helpInPre > -1) {
    preCommandArgs.splice(helpInPre);
    setHelpMode();
  } else if (isKnownCommand && helpInArgs === 0) {
    args.splice(helpInArgs);
    setHelpMode();
  }

  // 默认使用install命令
  if (!commandName) {
    commandName = 'install';
    isKnownCommand = true;
  }
  if (commandName === ('set': string) && args[0] === 'version') {
    commandName = ('policies': string);
    args.splice(0, 1, 'set-version');
    isKnownCommand = true;
  }
  // 未知的命令使用run
  if (!isKnownCommand) {
    // if command is not recognized, then set default to `run`
    args.unshift(commandName);
    commandName = 'run';
  }
  /**
   * 确定最终要执行的指令
   */ 
  const command = commands[commandName];

  let warnAboutRunDashDash = false;
  // we are using "yarn <script> -abc", "yarn run <script> -abc", or "yarn node -abc", we want -abc
  // to be script options, not yarn options

  // PROXY_COMMANDS is a map of command name to the number of preservedArgs
  const PROXY_COMMANDS = {
    run: 1, // yarn run {command}
    create: 1, // yarn create {project}
    node: 0, // yarn node
    workspaces: 1, // yarn workspaces {command}
    workspace: 2, // yarn workspace {package} {command}
  };
  if (PROXY_COMMANDS.hasOwnProperty(commandName)) {
    if (endArgs.length === 0) {
      // $FlowFixMe doesn't like that PROXY_COMMANDS doesn't have keys for all commands.
      let preservedArgs = PROXY_COMMANDS[commandName];

      // If the --into option immediately follows the command (or the script name in the "run/create"
      // case), we parse them as regular options so that we can cd into them
      if (args[preservedArgs] === `--into`) {
        preservedArgs += 2;
      }
      endArgs = ['--', ...args.splice(preservedArgs)];
    } else {
      warnAboutRunDashDash = true;
    }
  }

  args = [...preCommandArgs, ...args];

  command.setFlags(commander);
  commander.parse([
    ...startArgs,
    // we use this for https://github.com/tj/commander.js/issues/346, otherwise
    // it will strip some args that match with any options
    'this-arg-will-get-stripped-later',
    ...getRcArgs(commandName, args),
    ...args,
  ]);
  commander.args = commander.args.concat(endArgs.slice(1));

  // we strip cmd
  console.assert(commander.args.length >= 1);
  console.assert(commander.args[0] === 'this-arg-will-get-stripped-later');
  commander.args.shift();

  const Reporter = commander.json ? JSONReporter : ConsoleReporter;
  /**
   * 日志实例
   */
  const reporter = new Reporter({
    emoji: process.stdout.isTTY && commander.emoji,
    verbose: commander.verbose,
    noProgress: !commander.progress,
    isSilent: boolifyWithDefault(process.env.YARN_SILENT, false) || commander.silent,
    nonInteractive: commander.nonInteractive,
  });

  const exit = exitCode => {
    process.exitCode = exitCode || 0;
    reporter.close();
  };

  /**
   * 每秒都会查看当前heap堆占用内存
   */
  reporter.initPeakMemoryCounter();

  /**
   * config实例
   */
  const config = new Config(reporter);
  const outputWrapperEnabled = boolifyWithDefault(process.env.YARN_WRAP_OUTPUT, true);
  const shouldWrapOutput = outputWrapperEnabled && !commander.json && command.hasWrapper(commander, commander.args);

  if (shouldWrapOutput) {
    reporter.header(commandName, {name: 'yarn', version});
  }

  if (commander.nodeVersionCheck && !semver.satisfies(process.versions.node, constants.SUPPORTED_NODE_VERSIONS)) {
    // 忽略nodejs版本校验时会发出警告
    reporter.warn(reporter.lang('unsupportedNodeVersion', process.versions.node, constants.SUPPORTED_NODE_VERSIONS));
  }

  if (command.noArguments && commander.args.length) {
    // 没有任何参数则返回一场
    reporter.error(reporter.lang('noArguments'));
    reporter.info(command.getDocsInfo);
    exit(1);
    return;
  }

  //
  if (commander.yes) {
    reporter.warn(reporter.lang('yesWarning'));
  }

  //
  if (!commander.offline && network.isOffline()) {
    // 如果用户没有声明离线环境，且当前处于离线环境则提示用户
    reporter.warn(reporter.lang('networkWarning'));
  }

  /**
   * 实际执行命令
   */
  const run = (): Promise<void> => {
    invariant(command, 'missing command');

    if (warnAboutRunDashDash) {
      reporter.warn(reporter.lang('dashDashDeprecation'));
    }

    return command.run(config, reporter, commander, commander.args).then(exitCode => {
      if (shouldWrapOutput) {
        reporter.footer(false);
      }
      return exitCode;
    });
  };

  //
  const runEventuallyWithFile = (mutexFilename: ?string, isFirstTime?: boolean): Promise<void> => {
    return new Promise(resolve => {
      const lockFilename = mutexFilename || path.join(config.cwd, constants.SINGLE_INSTANCE_FILENAME);
      lockfile.lock(lockFilename, {realpath: false}, (err: mixed, release: (() => void) => void) => {
        if (err) {
          if (isFirstTime) {
            reporter.warn(reporter.lang('waitingInstance'));
          }
          setTimeout(() => {
            resolve(runEventuallyWithFile(mutexFilename, false));
          }, 200); // do not starve the CPU
        } else {
          onDeath(() => {
            process.exitCode = 1;
          });
          resolve(run().then(() => new Promise(resolve => release(resolve))));
        }
      });
    });
  };

  const runEventuallyWithNetwork = (mutexPort: ?string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const connectionOptions = {
        port: +mutexPort || constants.SINGLE_INSTANCE_PORT,
        host: 'localhost',
      };

      function startServer() {
        const clients = new Set();
        const server = http.createServer(manager);

        // The server must not prevent us from exiting
        server.unref();

        // No socket must timeout, so that they aren't closed before we exit
        server.timeout = 0;

        // If we fail to setup the server, we ask the existing one for its name
        server.on('error', () => {
          reportServerName();
        });

        // If we succeed, keep track of all the connected sockets to close them later
        server.on('connection', socket => {
          clients.add(socket);
          socket.on('close', () => {
            clients.delete(socket);
          });
        });

        server.listen(connectionOptions, () => {
          // Don't forget to kill the sockets if we're being killed via signals
          onDeath(killSockets);

          // Also kill the sockets if we finish, whether it's a success or a failure
          run().then(
            res => {
              killSockets();
              resolve(res);
            },
            err => {
              killSockets();
              reject(err);
            },
          );
        });

        function manager(request, response) {
          response.writeHead(200);
          response.end(JSON.stringify({cwd: config.cwd, pid: process.pid}));
        }

        function killSockets() {
          try {
            server.close();
          } catch (err) {
            // best effort
          }

          for (const socket of clients) {
            try {
              socket.destroy();
            } catch (err) {
              // best effort
            }
          }

          // If the process hasn't exited in the next 5s, it has stalled and we abort
          const timeout = setTimeout(() => {
            console.error('Process stalled');
            if (process._getActiveHandles) {
              console.error('Active handles:');
              // $FlowFixMe: getActiveHandles is undocumented, but it exists
              for (const handle of process._getActiveHandles()) {
                console.error(`  - ${handle.constructor.name}`);
              }
            }
            // eslint-disable-next-line no-process-exit
            process.exit(1);
          }, 5000);

          // This timeout must not prevent us from exiting
          // $FlowFixMe: Node's setTimeout returns a Timeout, not a Number
          timeout.unref();
        }
      }

      function reportServerName() {
        const request = http.get(connectionOptions, response => {
          const buffers = [];

          response.on('data', buffer => {
            buffers.push(buffer);
          });

          response.on('end', () => {
            try {
              const {cwd, pid} = JSON.parse(Buffer.concat(buffers).toString());
              reporter.warn(reporter.lang('waitingNamedInstance', pid, cwd));
            } catch (error) {
              reporter.verbose(error);
              reject(new Error(reporter.lang('mutexPortBusy', connectionOptions.port)));
              return;
            }
            waitForTheNetwork();
          });

          response.on('error', () => {
            startServer();
          });
        });

        request.on('error', () => {
          startServer();
        });
      }

      function waitForTheNetwork() {
        const socket = net.createConnection(connectionOptions);

        socket.on('error', () => {
          // catch & ignore, the retry is handled in 'close'
        });

        socket.on('close', () => {
          startServer();
        });
      }

      startServer();
    });
  };

  function onUnexpectedError(err: Error) {
    function indent(str: string): string {
      return '\n  ' + str.trim().split('\n').join('\n  ');
    }

    const log = [];
    log.push(`Arguments: ${indent(process.argv.join(' '))}`);
    log.push(`PATH: ${indent(process.env.PATH || 'undefined')}`);
    log.push(`Yarn version: ${indent(version)}`);
    log.push(`Node version: ${indent(process.versions.node)}`);
    log.push(`Platform: ${indent(process.platform + ' ' + process.arch)}`);

    log.push(`Trace: ${indent(err.stack)}`);

    // add manifests
    for (const registryName of registryNames) {
      const possibleLoc = path.join(config.cwd, registries[registryName].filename);
      const manifest = fs.existsSync(possibleLoc) ? fs.readFileSync(possibleLoc, 'utf8') : 'No manifest';
      log.push(`${registryName} manifest: ${indent(manifest)}`);
    }

    // lockfile
    const lockLoc = path.join(
      config.lockfileFolder || config.cwd, // lockfileFolder might not be set at this point
      constants.LOCKFILE_FILENAME,
    );
    const lockfile = fs.existsSync(lockLoc) ? fs.readFileSync(lockLoc, 'utf8') : 'No lockfile';
    log.push(`Lockfile: ${indent(lockfile)}`);

    const errorReportLoc = writeErrorReport(log);

    reporter.error(reporter.lang('unexpectedError', err.message));

    if (errorReportLoc) {
      reporter.info(reporter.lang('bugReport', errorReportLoc));
    }
  }

  function writeErrorReport(log): ?string {
    const errorReportLoc = config.enableMetaFolder
      ? path.join(config.cwd, constants.META_FOLDER, 'yarn-error.log')
      : path.join(config.cwd, 'yarn-error.log');

    try {
      fs.writeFileSync(errorReportLoc, log.join('\n\n') + '\n');
    } catch (err) {
      reporter.error(reporter.lang('fileWriteError', errorReportLoc, err.message));
      return undefined;
    }

    return errorReportLoc;
  }

  /**
   * package.json所在路经
   */
  const cwd = command.shouldRunInCurrentCwd ? commander.cwd : findProjectRoot(commander.cwd);

  const folderOptionKeys = ['linkFolder', 'globalFolder', 'preferredCacheFolder', 'cacheFolder', 'modulesFolder'];

  // Resolve all folder options relative to cwd
  const resolvedFolderOptions = {};
  folderOptionKeys.forEach(folderOptionKey => {
    // 用户指定文件路径
    const folderOption = commander[folderOptionKey];
    // 找到指定文件的绝对路径
    const resolvedFolderOption = folderOption ? path.resolve(commander.cwd, folderOption) : folderOption;
    resolvedFolderOptions[folderOptionKey] = resolvedFolderOption;
  });

  await config
    .init({
      cwd,
      commandName,
      ...resolvedFolderOptions,
      enablePnp: commander.pnp,
      disablePnp: commander.disablePnp,
      enableDefaultRc: commander.defaultRc,
      extraneousYarnrcFiles: commander.useYarnrc,
      binLinks: commander.binLinks,
      preferOffline: commander.preferOffline,
      captureHar: commander.har,
      ignorePlatform: commander.ignorePlatform,
      ignoreEngines: commander.ignoreEngines,
      ignoreScripts: commander.ignoreScripts,
      offline: commander.preferOffline || commander.offline,
      looseSemver: !commander.strictSemver,
      production: commander.production,
      httpProxy: commander.proxy,
      httpsProxy: commander.httpsProxy,
      registry: commander.registry,
      networkConcurrency: commander.networkConcurrency,
      networkTimeout: commander.networkTimeout,
      nonInteractive: commander.nonInteractive,
      updateChecksums: commander.updateChecksums,
      focus: commander.focus,
      otp: commander.otp,
    })
    .then(() => {
      // lockfile check must happen after config.init sets lockfileFolder
      if (command.requireLockfile && !fs.existsSync(path.join(config.lockfileFolder, constants.LOCKFILE_FILENAME))) {
        // 用户指定了yarn.lock文件，但文件不存在时则抛出异常
        throw new MessageError(reporter.lang('noRequiredLockfile'));
      }

      // option "no-progress" stored in yarn config
      const noProgressConfig = config.registries.yarn.getOption('no-progress');

      if (noProgressConfig) {
        reporter.disableProgress();
      }

      // verbose logs outputs process.uptime() with this line we can sync uptime to absolute time on the computer
      reporter.verbose(`current time: ${new Date().toISOString()}`);

      const mutex: mixed = commander.mutex;

      if (mutex && typeof mutex === 'string') {
        const separatorLoc = mutex.indexOf(':');
        let mutexType;
        let mutexSpecifier;
        if (separatorLoc === -1) {
          mutexType = mutex;
          mutexSpecifier = undefined;
        } else {
          mutexType = mutex.substring(0, separatorLoc);
          mutexSpecifier = mutex.substring(separatorLoc + 1);
        }

        if (mutexType === 'file') {
          return runEventuallyWithFile(mutexSpecifier, true).then(exit);
        } else if (mutexType === 'network') {
          return runEventuallyWithNetwork(mutexSpecifier).then(exit);
        } else {
          throw new MessageError(`Unknown single instance type ${mutexType}`);
        }
      } else {
        return run().then(exit);
      }
    })
    .catch((err: Error) => {
      reporter.verbose(err.stack);

      if (err instanceof ProcessTermError && reporter.isSilent) {
        return exit(err.EXIT_CODE || 1);
      }

      if (err instanceof MessageError) {
        reporter.error(err.message);
      } else {
        onUnexpectedError(err);
      }

      if (command.getDocsInfo) {
        reporter.info(command.getDocsInfo);
      }

      if (err instanceof ProcessTermError) {
        return exit(err.EXIT_CODE || 1);
      }

      return exit(1);
    });
}

/**
 * yarn命令入口方法
 */
async function start(): Promise<void> {
  // 获取yarnrc文件配置
  // process.cwd 当前执行命令项目目录
  // process.argv 用户指定的yarn命令和参数
  const rc = getRcConfigForCwd(process.cwd(), process.argv.slice(2));

  /**
   * .yarnrc中存在配置了yarn-path路径
   */
  const yarnPath = rc['yarn-path'] || rc['yarnPath'];

  if (yarnPath && !boolifyWithDefault(process.env.YARN_IGNORE_PATH, false)) {
    /**
     * yarn 命令 & 参数
     */
    const argv = process.argv.slice(2);
    const opts = {stdio: 'inherit', env: Object.assign({}, process.env, {YARN_IGNORE_PATH: 1})};
    let exitCode = 0;

    process.on(`SIGINT`, () => {
      // We don't want SIGINT to kill our process; we want it to kill the
      // innermost process, whose end will cause our own to exit.
    });

    try {
      if (yarnPath.endsWith(`.js`)) {
        // 以js结尾，执行js
        exitCode = await spawnp(process.execPath, [yarnPath, ...argv], opts);
      } else {
        exitCode = await spawnp(yarnPath, argv, opts);
      }
    } catch (firstError) {
      try {
        // 异常情况使用fork再次执行一遍
        exitCode = await forkp(yarnPath, argv, opts);
      } catch (error) {
        throw firstError;
      }
    }

    process.exitCode = exitCode;
  } else {
    // 以非js结尾执行cli
    // ignore all arguments after a --
    /**
     * -- 索引位置
     */
    const doubleDashIndex = process.argv.findIndex(element => element === '--');
    /**
     * 前两个参数为node地址、yarn文件地址
     */
    const startArgs = process.argv.slice(0, 2);
    /**
     * yarn子命令&参数
     * 如果存在 -- 则取 -- 之前部分
     * 如果不存在 -- 则取全部
     */
    const args = process.argv.slice(2, doubleDashIndex === -1 ? process.argv.length : doubleDashIndex);
    /**
     * yarn子命令透传参数
     */
    const endArgs = doubleDashIndex === -1 ? [] : process.argv.slice(doubleDashIndex);

    await main({startArgs, args, endArgs});
  }
}

// When this module is compiled via Webpack, its child
// count will be 0 since it is a single-file bundle.
/**
 * 通过webpack编译时，children个数为0
 */
export const autoRun = module.children.length === 0;

if (require.main === module) {
  start().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

export default start;
