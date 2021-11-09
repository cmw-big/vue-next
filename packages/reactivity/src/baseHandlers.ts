import {
  reactive,
  readonly,
  toRaw,
  ReactiveFlags,
  Target,
  readonlyMap,
  reactiveMap,
  shallowReactiveMap,
  shallowReadonlyMap
} from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import {
  track,
  trigger,
  ITERATE_KEY,
  pauseTracking,
  resetTracking
} from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  isIntegerKey,
  extend,
  makeMap
} from '@vue/shared'
import { isRef } from './ref'

const isNonTrackableKeys = /*#__PURE__*/ makeMap(`__proto__,__v_isRef,__isVue`)

// 获取Symbol上值是Symbol的属性值
const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)
// 带有/*#__PURE__*/的表示让rollup知道，这个函数是一个纯函数。可以被tree-shaking

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations = /*#__PURE__*/ createArrayInstrumentations()

function createArrayInstrumentations() {
  const instrumentations: Record<string, Function> = {}
    // instrument identity-sensitive Array methods to account for possible reactive
    // values
    ; (['includes', 'indexOf', 'lastIndexOf'] as const).forEach(key => {
      instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
        const arr = toRaw(this) as any
        for (let i = 0, l = this.length; i < l; i++) {
          track(arr, TrackOpTypes.GET, i + '')
        }
        // we run the method using the original args first (which may be reactive)
        const res = arr[key](...args)
        if (res === -1 || res === false) {
          // if that didn't work, run it again using raw values.
          return arr[key](...args.map(toRaw))
        } else {
          return res
        }
      }
    })
    // instrument length-altering mutation methods to avoid length being tracked
    // which leads to infinite loops in some cases (#2137)
    ; (['push', 'pop', 'shift', 'unshift', 'splice'] as const).forEach(key => {
      instrumentations[key] = function (this: unknown[], ...args: unknown[]) {
        pauseTracking()
        const res = (toRaw(this) as any)[key].apply(this, args)
        resetTracking()
        return res
      }
    })
  return instrumentations
}

/**
 * 创建一个getter函数
 * @param isReadonly 是否创建只读的getter
 * @param shallow 是否是浅层的getter。如果是浅层的getter的话，那么只会返回属性本身，如果不是浅层的getter，那么会代理属性
 * @returns 一个getter函数
 */
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: Target, key: string | symbol, receiver: object) {
    if (key === ReactiveFlags.IS_REACTIVE) {
      // 如果key是这个属性，有下面两种情况
      // 1. 如果是reactive/shallowReactive，那么返回值肯定是true。参数isReadonly是false。
      // 如果是通过原型进行访问的，也是一样的会返回相应的值
      return !isReadonly
    } else if (key === ReactiveFlags.IS_READONLY) {
      // 如果target是只读的，返回肯定是true。那么isReadonly也肯定是true。
      // const obj = {
      //   a: 1,
      //   b: {
      //     c: 2
      //   }
      // }
      // const state = readonly(obj)
      // const obj2 = Object.create(state)
      // console.log((obj2['__v_isReadonly'].x = 23)) // 可以设置
      // 上面这种情况，isReadonly依然是true，但是obj2['__v_isReadonly']是可以设置的。
      // 如果是通过原型进行访问的，也是一样的会返回相应的值
      return isReadonly
    } else if (
      // 访问RAW属性的时候：应该返回源对象。
      // 后面的判断是为了修复通过原型访问ReactiveFlags.RAW属性，导致得到的不准确的ReactiveFlags.RAW属性。
      // 例子： const obj = {
      //   a: 1,
      //   b: {
      //     c: 2
      //   }
      // }
      // const state = reactive(obj)
      // const obj2 = Object.create(state)
      // console.log(obj2['__v_raw']) // 应该返回undefined，而不是直接返回target本身
      // 如果有后面的判断的话，receiver就是obj2对象。target就是obj对象。对应的Map存储的就是target对应的代理对象proxy。
      // 如果recetive===proxy。那么说明访问__v_raw肯定不是通过原型链访问的。
      // 就应该返回target本身。否则就当作普通属性进行操作。
      key === ReactiveFlags.RAW &&
      receiver ===
      (isReadonly
        ? shallow
          ? shallowReadonlyMap
          : readonlyMap
        : shallow
          ? shallowReactiveMap
          : reactiveMap
      ).get(target)
    ) {
      return target
    }

    const targetIsArray = isArray(target)
    // 如果是数组，并且不是只读，并且访问的属性是数组上的一些方法，那么就返回我们构造的一个新的对象上的key，相当于代理了数组上的方法
    if (!isReadonly && targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }

    const res = Reflect.get(target, key, receiver)
    // 如果key是Symbol类型，就看是否是Symbol上的属性。是的话，就直接返回
    // 如果key不是sybol类型，就看是否是那几个特殊的属性。是的话就直接返回
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res
    }
    // 如果当前对象不是只读的话，获取了属性（调用了get）就需要搜集依赖
    if (!isReadonly) {
      track(target, TrackOpTypes.GET, key)
    }
    // 如果是浅的话，直接返回当前的值
    if (shallow) {
      return res
    }
    // 这个暂时没有了解到什么意思
    if (isRef(res)) {
      // ref unwrapping - does not apply for Array + integer key.
      const shouldUnwrap = !targetIsArray || !isIntegerKey(key)
      return shouldUnwrap ? res.value : res
    }
    // 如果是对象的话，就把当前的res进行代理（readonly或者reactive）
    if (isObject(res)) {
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      return isReadonly ? readonly(res) : reactive(res)
    }
    // 如果啥都不是的话，就直接返回值。比如通过原型链进行访问的普通属性。就直接返回值。上面的所有的判断都不会走
    return res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

/**
 * 创建setter的函数。
 * @param shallow 是否是浅代理对象。默认是false
 * @returns 返回值是setter函数。
 */
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    // 老值
    let oldValue = (target as any)[key]
    if (!shallow) {
      value = toRaw(value) // 如果设置的是一个响应式对象的话，需要得到源对象才行。
      oldValue = toRaw(oldValue) // 如果老值也是一个响应式的，也需要得到老的源对象才行。
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        // 如果不是数组，并且老值是Ref，并且新值不是Ref。那么就把老值的value赋值给新值。
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
      // 在浅层模式（shallowReadonly,shallowReactive）下，对象就是按照普通的方式进行设置。啥也不用干
      console.log("浅层")
    }

    const hadKey =
      isArray(target) && isIntegerKey(key)
        ? Number(key) < target.length
        : hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
    return result
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  if (!isSymbol(key) || !builtInSymbols.has(key)) {
    track(target, TrackOpTypes.HAS, key)
  }
  return result
}

function ownKeys(target: object): (string | symbol)[] {
  track(target, TrackOpTypes.ITERATE, isArray(target) ? 'length' : ITERATE_KEY)
  return Reflect.ownKeys(target)
}

/**
 * 导出一个reactive的proxyHandler对象
 */
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}
/**
 * 导出一个只读的proxyHandler对象
 */
export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}
/**
 * 导出一个浅层的reactive的proxyHandler对象
 */
export const shallowReactiveHandlers = /*#__PURE__*/ extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers = /*#__PURE__*/ extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
