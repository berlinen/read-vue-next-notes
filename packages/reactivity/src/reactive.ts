import { isObject, toRawType } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers
} from './collectionHandlers'
import { UnwrapRef, Ref } from './ref'
import { makeMap } from '@vue/shared'

// WeakMaps that store {raw <-> observed} pairs.
const rawToReactive = new WeakMap<any, any>()
const reactiveToRaw = new WeakMap<any, any>()
const rawToReadonly = new WeakMap<any, any>()
const readonlyToRaw = new WeakMap<any, any>()

// WeakSets for values that are marked readonly or non-reactive during
// observable creation.
const rawValues = new WeakSet<any>()

const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)
/**
 * @description
 * 限制reactive白名单
 * 带有 __v_skip 属性的对象、被冻结的对象，以及不在白名单内的对象如 Date 类型的对象实例是不能变成响应式的
 * @param value
 */
const canObserve = (value: any): boolean => {
  return (
    !value._isVue &&
    !value._isVNode &&
    isObservableType(toRawType(value)) &&
    !rawValues.has(value) &&
    !Object.isFrozen(value)
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
/**
 * @desc
 * 响应式过程
* mutableHandlers = {
   get, 访问对象属性会触发 get 函数；
   set, 设置对象属性会触发 set 函数；
   deleteProperty, 删除对象属性会触发 deleteProperty 函数；
   has, in 操作符会触发 has 函数；
   ownKeys 通过 Object.getOwnPropertyNames 访问对象属性名会触发 ownKeys 函数。
  }
  因为无论命中哪个处理器函数，它都会做 依赖收集 和 派发通知 这两件事其中的一个，所以这里我只要分析常用的 get 和 set 函数就可以了。
 * @param target
 */
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果尝试把一个 readonly proxy 变成响应式， 直接返回这个 readonly proxy
  if (readonlyToRaw.has(target)) {
    return target
  }
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are reactive, and does NOT unwrap refs nor recursively convert
// returned properties.
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    rawToReactive,
    reactiveToRaw,
    shallowReactiveHandlers,
    mutableCollectionHandlers
  )
}

export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are readonly, and does NOT unwrap refs nor recursively convert
// returned properties.
// This is used for creating the props proxy object for stateful components.
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    rawToReadonly,
    readonlyToRaw,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}
/**
 * @description
 * Vue.js 3.0 的 reactive API 就是通过 Proxy 劫持数据，而且由于 Proxy 劫持的是整个对象，所以我们可以检测到任何对对象的修改，弥补了 Object.defineProperty API 的不足。
 *
 * 创建响应式
 * 1. 函数首先判断 target 是不是数组或者对象类型，如果不是则直接返回。所以原始数据 target 必须是对象或者数组。
 * 2. 如果对一个已经是响应式的对象再次执行 reactive，还应该返回这个响应式对象
 * @example
 * import { reacrive } from 'vue'
 * const original = { foo: 1 }
 * const observerd = reactivive(original)
 * const observerdw = reactive(observed)
 * observed === observed2
 *
 * 可以看到 observed 已经是响应式结果了，如果对它再去执行 reactive，返回的值 observed2 和 observed 还是同一个对象引用。
 *
 * 因为这里 reactive 函数会通过 target.__v_raw 属性来判断 target 是否已经是一个响应式对象（因为响应式对象的 __v_raw 属性会指向它自身，后面会提到），如果是的话则直接返回响应式对象。
 *
 * 3.如果对同一个原始数据多次执行 reactive ，那么会返回相同的响应式对象，举个例子
 * @example
 * import { reactive } from 'vue'
 * const  original = { foo: 1}
 * const observed = reactive(original)
 * const observed3 = reactive(original)
 * oberved === observed2
 *
 * 所以这里 reactive 函数会通过 target.__v_reactive 判断 target 是否已经有对应的响应式对象（因为创建完响应式对象后，会给原始对象打上 __v_reactive 标识，后面会提到），如果有则返回这个响应式对象。
 *
 * 4.使用 canObserve 函数对 target 对象做一进步限制：
 *
 * 5. 通过 Proxy API 劫持 target 对象，把它变成响应式。我们把 Proxy 函数返回的结果称作响应式对象，这里 Proxy 对应的处理器对象会根据数据类型的不同而不同，reactive 函数传入的 baseHandlers 值是 mutableHandlers。
 *
 * 6.给原始数据打个标识
 *
 * target.__v_reactive = observed
 *
 * 这就是前面“对同一个原始数据多次执行 reactive ，那么会返回相同的响应式对象”逻辑的判断依据
 *
 * @readonly
 *
 * readonly 和 reactive 函数的主要区别，就是执行 createReactiveObject 函数时的参数 isReadonly 不同。
 *
 * 
 *
 * @param target
 * @param toProxy
 * @param toRaw
 * @param baseHandlers
 * @param collectionHandlers
 */
function createReactiveObject(
  target: unknown,
  toProxy: WeakMap<any, any>,
  toRaw: WeakMap<any, any>,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  // 目标必须是对象或者是数组类型
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target already has corresponding Proxy
  let observed = toProxy.get(target)
  if (observed !== void 0) {
    // target 已经是 proxy 对象 直接返回
    // 有个例外，如果是 readonly 作用于一个响应式对象，则继续
    return observed
  }
  // target is already a Proxy

  if (toRaw.has(target)) {
    // target 已经有对应的 Proxy 了
    return target
  }
  // only a whitelist of value types can be observed.
  // 只有在白名单里的数据类型才能变成响应式
  if (!canObserve(target)) {
    return target
  }
  const handlers = collectionTypes.has(target.constructor)
    ? collectionHandlers
    : baseHandlers
  // 利用 Proxy 创建响应式
  observed = new Proxy(target, handlers)
  // 给原始数据打个标识，说明它已经变成响应式，并且有对应的 Proxy 了
  toProxy.set(target, observed)
  toRaw.set(observed, target)
  return observed
}

export function isReactive(value: unknown): boolean {
  value = readonlyToRaw.get(value) || value
  return reactiveToRaw.has(value)
}

export function isReadonly(value: unknown): boolean {
  return readonlyToRaw.has(value)
}

export function isProxy(value: unknown): boolean {
  return readonlyToRaw.has(value) || reactiveToRaw.has(value)
}

export function toRaw<T>(observed: T): T {
  observed = readonlyToRaw.get(observed) || observed
  return reactiveToRaw.get(observed) || observed
}

export function markRaw<T extends object>(value: T): T {
  rawValues.add(value)
  return value
}
