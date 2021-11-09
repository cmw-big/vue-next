/**
 * Make a map and return a function for checking if a key
 * is in that map.
 * 构造一个map对象。并且返回一个方法去检查key是否在这个map中。
 *
 * IMPORTANT: all calls of this function must be prefixed with
 * \/\*#\_\_PURE\_\_\*\/
 * So that rollup can tree-shake them if necessary.
 * 重要：所有调用这个函数的必须加上\/\*#\_\_PURE\_\_\*\/
 * 这样的话，rollup可以进行tree-shake。
 */
export function makeMap(
  str: string,
  expectsLowerCase?: boolean
): (key: string) => boolean {
  const map: Record<string, boolean> = Object.create(null)
  const list: Array<string> = str.split(',')
  for (let i = 0; i < list.length; i++) {
    map[list[i]] = true
  }
  return expectsLowerCase ? val => !!map[val.toLowerCase()] : val => !!map[val]
}
