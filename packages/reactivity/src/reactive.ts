import { isObject, toRawType, def } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers,
  shallowReadonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRefSimple, Ref } from './ref'

export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  RAW = '__v_raw'
}

// Target对象上的一些标记
export interface Target {
  [ReactiveFlags.SKIP]?: boolean // skip是跳过的意思，表示当前target不会被代理，直接返回相应的值。不会走gettter
  [ReactiveFlags.IS_REACTIVE]?: boolean // 当前target是否是响应式对象。
  [ReactiveFlags.IS_READONLY]?: boolean // 是否是只读的，如果是只读的话，target也会直接返回相应的值
  [ReactiveFlags.RAW]?: any // 被代理对象的源对象 const p = reactive(obj);p[RectiveFlags.RAW]===obj为true
}

// 因为ts是鸭子辩型法，所有，存储的已经代理的对象的值，是Target类型就够了
export const reactiveMap = new WeakMap<Target, any>()
export const shallowReactiveMap = new WeakMap<Target, any>()
export const readonlyMap = new WeakMap<Target, any>()
export const shallowReadonlyMap = new WeakMap<Target, any>()

// 代理对象target的类型
const enum TargetType {
  INVALID = 0, // 无效类型
  COMMON = 1, // 正常类型：Object,Array
  COLLECTION = 2 // 搜集类型。Map,Set,WeakMap,WeakSet
}

function targetTypeMap(rawType: string) {
  switch (rawType) {
    case 'Object':
    case 'Array':
      return TargetType.COMMON
    case 'Map':
    case 'Set':
    case 'WeakMap':
    case 'WeakSet':
      return TargetType.COLLECTION
    default:
      return TargetType.INVALID
  }
}

function getTargetType(value: Target) {
  return value[ReactiveFlags.SKIP] || !Object.isExtensible(value) // value是否是可扩展的。在上面添加新的属性
    ? TargetType.INVALID
    : targetTypeMap(toRawType(value))
}

// only unwrap nested ref
export type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRefSimple<T>

/**
 * Creates a reactive copy of the original object.
 *
 * The reactive conversion is "deep"—it affects all nested properties. In the
 * ES2015 Proxy based implementation, the returned proxy is **not** equal to the
 * original object. It is recommended to work exclusively with the reactive
 * proxy and avoid relying on the original object.
 *
 * A reactive object also automatically unwraps refs contained in it, so you
 * don't need to use `.value` when accessing and mutating their value:
 *
 * ```js
 * const count = ref(0)
 * const obj = reactive({
 *   count
 * })
 *
 * obj.count++
 * obj.count // -> 1
 * count.value // -> 1
 * ```
 */
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  )
}

export declare const ShallowReactiveMarker: unique symbol

export type ShallowReactive<T> = T & { [ShallowReactiveMarker]?: true }

/**
 * Return a shallowly-reactive copy of the original object, where only the root
 * level properties are reactive. It also does not auto-unwrap refs (even at the
 * root level).
 */
export function shallowReactive<T extends object>(
  target: T
): ShallowReactive<T> {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends ReadonlyMap<infer K, infer V>
  ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends WeakMap<infer K, infer V>
  ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
  : T extends Set<infer U>
  ? ReadonlySet<DeepReadonly<U>>
  : T extends ReadonlySet<infer U>
  ? ReadonlySet<DeepReadonly<U>>
  : T extends WeakSet<infer U>
  ? WeakSet<DeepReadonly<U>>
  : T extends Promise<infer U>
  ? Promise<DeepReadonly<U>>
  : T extends Ref<infer U>
  ? Ref<DeepReadonly<U>>
  : T extends {}
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : Readonly<T>

/**
 * Creates a readonly copy of the original object. Note the returned copy is not
 * made reactive, but `readonly` can be called on an already reactive object.
 */
export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap
  )
}

/**
 * Returns a reactive-copy of the original object, where only the root level
 * properties are readonly, and does NOT unwrap refs nor recursively convert
 * returned properties.
 * This is used for creating the props proxy object for stateful components.
 */
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap
  )
}
/**
 *
 * @param target 目标对象
 * @param isReadonly target是否是只读对象
 * @param baseHandlers  基础的ProxyHandler
 * @param collectionHandlers Map和Set的的特殊的ProxyHandler
 * @param proxyMap 已经存储过的相应的缓存WeakMap
 * @returns target本身或者被Proxy代理后的对象
 */
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>,
  proxyMap: WeakMap<Target, any>
) {
  // 如果不是对象。就直接返回值本身。在__DEV__环境下，再给出一个警告⚠️
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.（target如果已经是一个代理对象，上面一定有ReactiveFlags.RAW属性，直接返回它。代理一个代理对象）
  // exception: calling readonly() on a reactive object（例外：在一个reactive对象中调用readonly()，
  // 意思就是：一个额外的例子=》可以在已经被代理过的reactive对象中调用readonly）
  // target已经被代理过（有RAW），并且不是为了[将响应式对象（有IS_REACTIVE）变为只读（isReadonly]）则直接返回
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target already has corresponding Proxy
  // 如果对象已经被对应WeakMap的缓存过，那么就直接返回。
  const existingProxy = proxyMap.get(target)
  if (existingProxy) {
    return existingProxy
  }
  // only a whitelist of value types can be observed.
  // 只有target类型是有效的才能被代理观测。如果不是有效的值，则直接返回target。
  // Object，Array，Map，Set，WeakMap，WeakSet这几种中的不带SKIP属性，并且可以扩展的。
  const targetType = getTargetType(target)
  if (targetType === TargetType.INVALID) {
    return target
  }
  // 然后就进行数据的代理。利用Proxy。根据数据类型不同，ProxyHandler对象也不同：一个collectionHandlers，一个baseHandlers
  const proxy = new Proxy(
    target,
    targetType === TargetType.COLLECTION ? collectionHandlers : baseHandlers
  )
  // 代理完成，就在对应的缓存里存一下，然后返回这个proxy对象
  proxyMap.set(target, proxy)
  return proxy
}

// 是否是响应式对象
export function isReactive(value: unknown): boolean {
  // 这里的一个判断就是：因为可以用readonly(target)。target可以是响应式对象。所以，readonly对象也可以是响应式对象
  if (isReadonly(value)) {
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

// 是否是只读对象。只有判断当前value是否有IS_READONLY属性是否为true就行了
export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}
// 判断value是否被代理过。只用判断当前是否是reactive或者readonly就行
export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}
// 获取源对象。如果当前对象是代理对象，就递归，如果不是代理对象，就直接返回。
export function toRaw<T>(observed: T): T {
  const raw = observed && (observed as Target)[ReactiveFlags.RAW]
  return raw ? toRaw(raw) : observed
}
//
export function markRaw<T extends object>(value: T): T {
  def(value, ReactiveFlags.SKIP, true)
  return value
}
// 让一个值成为响应式对象。功能和reactive一样
export const toReactive = <T extends unknown>(value: T): T =>
  isObject(value) ? reactive(value) : value

// 让一个值成为只读对象。功能和readonly一样。只是在开发环境中没有警告⚠️
export const toReadonly = <T extends unknown>(value: T): T =>
  isObject(value) ? readonly(value) : value
