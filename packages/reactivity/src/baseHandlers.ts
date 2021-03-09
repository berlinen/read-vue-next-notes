import { reactive, readonly, toRaw } from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { track, trigger, ITERATE_KEY } from './effect'
import { isObject, hasOwn, isSymbol, hasChanged, isArray } from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)
/**
 * @description
 * 处理对应数组情况
 */
const arrayInstrumentations: Record<string, Function> = {}
;['includes', 'indexOf', 'lastIndexOf'].forEach(key => {
  arrayInstrumentations[key] = function(...args: any[]): any {
     // toRaw 可以把响应式对象转成原始数据
    const arr = toRaw(this) as any
    for (let i = 0, l = (this as any).length; i < l; i++) {
      // 依赖收集
      track(arr, TrackOpTypes.GET, i + '')
    }
    // we run the method using the original args first (which may be reactive)
    // 先尝试用参数本身，可能是响应式数据
    const res = arr[key](...args)
    if (res === -1 || res === false) {
      // if that didn't work, run it again using raw values.
      // 如果失败，再尝试把参数转成原始数据
      return arr[key](...args.map(toRaw))
    } else {
      return res
    }
  }
})
/**
 * @description
 * 依赖收集get函数
 * 依赖收集发生在数据访问的阶段, 由于我们用 Proxy API 劫持了数据对象，所以当这个响应式对象属性被访问的时候就会执行 get 函数
 *  主要做四件事情
 *  1. 对特殊的 key 做了代理
 *  这就是为什么我们在 createReactiveObject 函数中判断响应式对象是否存在 __v_raw 属性，如果存在就返回这个响应式对象本身。
 *  2. Reflect.get 方法求值
 *  如果 target 是数组且 key 命中了 arrayInstrumentations，则执行对应的函数，
 *
 *  当 target 是一个数组的时候，我们去访问 target.includes、target.indexOf 或者 target.lastIndexOf 就会执行 arrayInstrumentations 代理的函数，除了调用数组本身的方法求值外，还对数组每个元素做了依赖收集，
 * 因为一旦数组的元素被修改，数组的这几个 API 的返回结果都可能发生变化，所以我们需要跟踪数组每个元素的变化。
 *
 * 3。通过 Reflect.get 求值，然后会执行 track 函数收集依赖
 *
 * 4. 会对计算的值 res 进行判断
 * 如果它也是数组或对象，则递归执行 reactive 把 res 变成响应式对象。
 * 这么做是因为 Proxy 劫持的是对象本身，并不能劫持子对象的变化，这点和 Object.defineProperty API 一致。
 *
 * 但是 Object.defineProperty 是在 初始化阶段，  即定义劫持对象的时候就已经递归执行了，而 Proxy 是在对象属性被访问的时候才递归执行下一步 reactive，这其实是一种延时定义子对象响应式的实现，在性能上会有较大的提升。
 *
 * @param isReadonly
 * 它和 reactive API 最大的区别就是不做依赖收集了，这一点也非常好理解，因为它的属性不会被修改，所以就不用跟踪它的变化了。
 * @param shallow
 */
function createGetter(isReadonly = false, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    const targetIsArray = isArray(target)
    if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
      // 代理 observed.__v_isReactive
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
    const res = Reflect.get(target, key, receiver)

    if (isSymbol(key) && builtInSymbols.has(key)) {
      // 内置 Symbol key 不需要依赖收集
      return res
    }

    if (shallow) {
      // 代理 observed.__v_isReadonly
      // isReadonly 为 true 则不需要依赖收集
      !isReadonly && track(target, TrackOpTypes.GET, key)
      return res
    }

    if (isRef(res)) {
      if (targetIsArray) {
         // arrayInstrumentations 包含对数组一些方法修改的函数
        !isReadonly && track(target, TrackOpTypes.GET, key)
        return res
      } else {
        // ref unwrapping, only for Objects, not for Arrays.
        return res.value
      }
    }
    // 求值
    !isReadonly && track(target, TrackOpTypes.GET, key)
    return isObject(res)
      ? isReadonly
        ? // need to lazy access readonly and reactive here to avoid
          // circular dependency
          // 如果 res 是个对象或者数组类型，则递归执行 readonly 函数把 res readonly
          readonly(res)
         // 如果 res 是个对象或者数组类型，则递归执行 reactive 函数把 res 变成响应式
         // 如果它也是数组或对象，则递归执行 reactive 把 res 变成响应式对象。
        : reactive(res)
      : res
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)
/**
 * @description
 * 派发通知 set函数
 * 派发通知发生在数据更新的阶段， 由于我们用 Proxy API 劫持了数据对象，所以当这个响应式对象属性更新的时候就会执行 set 函数。
 * 1. 通过 Reflect.set 求值  2. 通过 trigger 函数派发通知
 * @param shallow
 */
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    const oldValue = (target as any)[key]
    if (!shallow) {
      value = toRaw(value)
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    const hadKey = hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
     // 如果目标的原型链也是一个 proxy，通过 Reflect.set 修改原型链上的属性会再次触发 setter，这种情况下就没必要触发两次 trigger 了
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
  track(target, TrackOpTypes.HAS, key)
  return result
}

function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
  return Reflect.ownKeys(target)
}
/**
 * proxy 所要劫持的对象
 */
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}
/**
 * @description
 * 处理readony reactive
 * readonlyHandlers 和 mutableHandlers 的区别主要在 get、set 和 deleteProperty 三个函数上。很显然，作为一个只读的响应式对象，是不允许修改属性以及删除属性的，所以在非生产环境下 set 和 deleteProperty 函数的实现都会报警告，提示用户 target 是 readonly 的。
 */
export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  has,
  ownKeys,
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

export const shallowReactiveHandlers: ProxyHandler<object> = {
  ...mutableHandlers,
  get: shallowGet,
  set: shallowSet
}

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ProxyHandler<object> = {
  ...readonlyHandlers,
  get: shallowReadonlyGet
}
