/* @flow */
import {forwardSignalToSpawnedProcesses} from './child.js';

function forwardSignalAndExit(signal: string) {
  forwardSignalToSpawnedProcesses(signal);
  // We want to exit immediately here since `SIGTERM` means that
  // If we lose stdout messages due to abrupt exit, shoot the messenger?
  // 退出时返回 1 表示异常退出
  process.exit(1); // eslint-disable-line no-process-exit
}

/**
 * 监听 SIGTERM 事件并关闭杀掉全部子进程
 */
export default function handleSignals() {
  process.on('SIGTERM', () => {
    forwardSignalAndExit('SIGTERM');
  });
}
