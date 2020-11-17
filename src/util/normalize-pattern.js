/* @flow */
/**
 * Explode and normalize a pattern into its name and range.
 */

 /**
  * 将依赖包的版本转为规范化的信息
  * eq: concat-stream@^1.5.0 => { name: 'concat-stream', range: '^1.5.0', hasVersion: true }
  * @param {*} pattern 
  */
export function normalizePattern(
  pattern: string,
): {
  hasVersion: boolean,
  name: string,
  range: string,
} {
  let hasVersion = false;
  let range = 'latest';
  let name = pattern;

  // if we're a scope then remove the @ and add it back later
  let isScoped = false;
  if (name[0] === '@') {
    isScoped = true;
    name = name.slice(1);
  }

  // take first part as the name
  const parts = name.split('@');
  if (parts.length > 1) {
    name = parts.shift();
    range = parts.join('@');

    if (range) {
      hasVersion = true;
    } else {
      range = '*';
    }
  }

  // add back @ scope suffix
  if (isScoped) {
    name = `@${name}`;
  }

  return {name, range, hasVersion};
}
