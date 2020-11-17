/* @flow */

const FALSY_STRINGS = new Set(['0', 'false']);

/**
 * 判断val是否为 0 或 false
 * @param {*} val 
 */
export function boolify(val: string | number | boolean): boolean {
  return !FALSY_STRINGS.has(val.toString().toLowerCase());
}

/**
 * 返回指定val的值是有有效
 * @param {*} val 目标值
 * @param {*} defaultResult 无效返回默认值
 */
export function boolifyWithDefault(val: ?(string | number | boolean), defaultResult: boolean): boolean {
  return val === '' || val === null || val === undefined ? defaultResult : boolify(val);
}
