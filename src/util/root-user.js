/* @flow */

/**
 * 返回 Node.js 进程的数字标记的用户身份
 * 在 Windows 或 Android 平台无效
 */
function getUid(): ?number {
  if (process.platform !== 'win32' && process.getuid) {
    return process.getuid();
  }
  return null;
}

/**
 * 是否为root用户标志
 */
export default isRootUser(getUid()) && !isFakeRoot();

export function isFakeRoot(): boolean {
  return Boolean(process.env.FAKEROOTKEY);
}

/**
 * 判断uid是否为root用户 0
 * @param {*}} uid 
 */
export function isRootUser(uid: ?number): boolean {
  return uid === 0;
}
