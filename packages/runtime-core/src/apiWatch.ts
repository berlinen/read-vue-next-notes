import {
  effect,
  stop,
  isRef,
  Ref,
  ComputedRef,
  ReactiveEffectOptions
} from '@vue/reactivity'
import { queueJob } from './scheduler'
import {
  EMPTY_OBJ,
  isObject,
  isArray,
  isFunction,
  isString,
  hasChanged,
  NOOP,
  remove
} from '@vue/shared'
import {
  currentInstance,
  ComponentInternalInstance,
  isInSSRComponentSetup,
  recordInstanceBoundEffect
} from './component'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { onBeforeUnmount } from './apiLifecycle'
import { queuePostRenderEffect } from './renderer'
import { warn } from './warning'

export type WatchEffect = (onInvalidate: InvalidateCbRegistrator) => void

export type WatchSource<T = any> = Ref<T> | ComputedRef<T> | (() => T)

export type WatchCallback<V = any, OV = any> = (
  value: V,
  oldValue: OV,
  onInvalidate: InvalidateCbRegistrator
) => any

type MapSources<T> = {
  [K in keyof T]: T[K] extends WatchSource<infer V> ? V : never
}

type MapOldSources<T, Immediate> = {
  [K in keyof T]: T[K] extends WatchSource<infer V>
    ? Immediate extends true ? (V | undefined) : V
    : never
}

type InvalidateCbRegistrator = (cb: () => void) => void

export interface BaseWatchOptions {
  flush?: 'pre' | 'post' | 'sync'
  onTrack?: ReactiveEffectOptions['onTrack']
  onTrigger?: ReactiveEffectOptions['onTrigger']
}

export interface WatchOptions<Immediate = boolean> extends BaseWatchOptions {
  immediate?: Immediate
  deep?: boolean
}

export type StopHandle = () => void

const invoke = (fn: Function) => fn()

// Simple effect.
export function watchEffect(
  effect: WatchEffect,
  options?: BaseWatchOptions
): StopHandle {
  return doWatch(effect, null, options)
}

// initial value for watchers to trigger on undefined initial values
const INITIAL_WATCHER_VALUE = {}

// overload #1: single source + cb
export function watch<T, Immediate extends Readonly<boolean> = false>(
  source: WatchSource<T>,
  cb: WatchCallback<T, Immediate extends true ? (T | undefined) : T>,
  options?: WatchOptions<Immediate>
): StopHandle

// overload #2: array of multiple sources + cb
// Readonly constraint helps the callback to correctly infer value types based
// on position in the source array. Otherwise the values will get a union type
// of all possible value types.
export function watch<
  T extends Readonly<WatchSource<unknown>[]>,
  Immediate extends Readonly<boolean> = false
>(
  sources: T,
  cb: WatchCallback<MapSources<T>, MapOldSources<T, Immediate>>,
  options?: WatchOptions<Immediate>
): StopHandle

// implementation
export function watch<T = any>(
  source: WatchSource<T> | WatchSource<T>[],
  cb: WatchCallback<T>,
  options?: WatchOptions
): StopHandle {
  if (__DEV__ && !isFunction(cb)) {
    warn(
      `\`watch(fn, options?)\` signature has been moved to a separate API. ` +
        `Use \`watchEffect(fn, options?)\` instead. \`watch\` now only ` +
        `supports \`watch(source, cb, options?) signature.`
    )
  }
  return doWatch(source, cb, options)
}
/**
 * @description
 * 解析watch
 * 1. 标准化 source
 * source 标准化主要是根据 source 的类型
 *    1. 如果 source 是 ref 对象，则创建一个访问 source.value 的 getter 函数;
 *
 *    2. 如果 source 是 reactive 对象，则创建一个访问 source 的 getter 函数，并设置 deep 为 true
 *
 *    3. 如果 source 是一个函数，则会进一步判断第二个参数 cb 是否存在，对于 watch API 来说，cb 是一定存在且是 一个回调函数，这种情况下，getter 就是一个简单的对 source 函数封装的函数。
 *
 *    最终标准化生成的 getter 函数，它会返回一个响应式对象，在后续创建 effect runner 副作用函数需要用到，每次执行 runner 就会把 getter 函数返回的响应式对象作为 watcher 求值的结果，
 *
 *     当我们执行 watch 函数的时候，我们知道如果侦听的是一个 reactive 对象，那么内部会设置 deep 为 true，然后执行 traverse 去递归访问对象深层子属性，
 * 2. 构造 applyCb 回调函数
 *
 *    1. cb 是一个回调函数，它有三个参数：第一个 newValue 代表新值；第二个 oldValue 代表旧值。第三个参数 onInvalidate
 *
 *    首先，watch API 和组件实例相关，因为通常我们会在组件的 setup 函数中使用它，当组件销毁后，回调函数 cb 不应该被执行而是直接返回。
 *
 *    接着，执行 runner 求得新值，这里实际上就是执行前面创建的 getter 函数求新值。
 *
 *    如果是 deep 的情况或者新旧值发生了变化，则执行回调函数 cb，传入参数 newValue 和 oldValue。注意，第一次执行的时候旧值的初始值是空数组或者 undefined。执行完回调函数 cb 后，把旧值 oldValue 再更新为 newValue，这是为了下一次的比对。
 * 3. 创建 scheduler 时序执行函数
 *    scheduler 的作用是根据某种调度的方式去执行某种函数，在 watch API 中，主要影响到的是回调函数的执行方式。
 *    scheduler 的创建逻辑受到了第三个参数 Options 中的 flush 属性值的影响，不同的 flush 决定了 watcher 的执行时机。
 *    当 flush 为 sync 的时候，表示它是一个同步 watcher，即当数据变化时同步执行回调函数。
 *    当 flush 为 pre 的时候，回调函数通过 queueJob 的方式在组件更新之前执行，如果组件还没挂载，则同步执行确保回调函数在组件挂载之前执行。
 *    如果没设置 flush，那么回调函数通过 queuePostRenderEffect 的方式在组件更新之后执行。
 *
 *    queueJob:
 *
 *    queuePostRenderEffect:
 *
 *
 * 4. 创建 effect 副作用函数
 *
 *    runner 是一个 computed effect。。因为 computed effect 可以优先于普通的 effect（比如组件渲染的 effect）先运行，这样就可以实现当配置 flush 为 pre 的时候，watcher 的执行可以优先于组件更新。
 *
 *    runner 执行的方式。runner 是 lazy 的，它不会在创建后立刻执行。第一次手动执行 runner 会执行前面的 getter 函数，访问响应式数据并做依赖收集。注意，此时activeEffect 就是 runner，这样在后面更新响应式数据时，就可以触发 runner 执行 scheduler 函数，以一种调度方式来执行回调函数。
 *
 *    runner 的返回结果。手动执行 runner 就相当于执行了前面标准化的 getter 函数，getter 函数的返回值就是 watcher 计算出的值，所以我们第一次执行 runner 求得的值可以作为 oldValue。
 *
 *    配置了 immediate 的情况。当我们配置了 immediate ，创建完 watcher 会立刻执行 applyCb 函数，此时 oldValue 还是初始值，在 applyCb 执行时也会执行 runner 进而执行前面的 getter 函数做依赖收集，求得新值。
 *
 * 5. 返回侦听器销毁函数
 *
 *  销毁函数内部会执行 stop 方法让 runner 失活，并清理 runner 的相关依赖，这样就可以停止对数据的侦听。并且，如果是在组件中注册的 watcher，也会移除组件 effects 对这个 runner 的引用。
 * @param source // getter
 * @param cb
 * @param param2
 */
function doWatch(
  source: WatchSource | WatchSource[] | WatchEffect,
  cb: WatchCallback | null,
  { immediate, deep, flush, onTrack, onTrigger }: WatchOptions = EMPTY_OBJ
): StopHandle {
  if (__DEV__ && !cb) {
    if (immediate !== undefined) {
      warn(
        `watch() "immediate" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
    if (deep !== undefined) {
      warn(
        `watch() "deep" option is only respected when using the ` +
          `watch(source, callback, options?) signature.`
      )
    }
  }

  const instance = currentInstance

  let getter: () => any
  if (isArray(source)) {
    getter = () =>
      source.map(
        s =>
          isRef(s)
            ? s.value
            : callWithErrorHandling(s, instance, ErrorCodes.WATCH_GETTER)
      )
      // 判断是不是ref
  } else if (isRef(source)) {
    getter = () => source.value
     // 判断getter是不是回调函数
  } else if (cb) {
    // getter with cb
    getter = () =>
      callWithErrorHandling(source, instance, ErrorCodes.WATCH_GETTER)
  } else {
    // 也走watchEffect
    // no cb -> simple effect
    // 执行清理函数
    getter = () => {
      // 它会先判断组件实例是否已经销毁，
      if (instance && instance.isUnmounted) {
        return
      }
      // 每次执行 source 函数前执行 cleanup 清理函数。
      if (cleanup) {
        cleanup()
      }
      // 执行 source 函数，传入 onInvalidate 作为参数
      return callWithErrorHandling(
        source,
        instance,
        ErrorCodes.WATCH_CALLBACK,
        [onInvalidate]
      )
    }
  }
  // deep 为 true 的情况
  // 此时，我们会发现生成的 getter 函数会被 traverse 函数包装一层
  // traverse 函数的实现很简单，即通过递归的方式访问 value 的每一个子属性
  if (cb && deep) {
    const baseGetter = getter
    getter = () => traverse(baseGetter())
  }

  let cleanup: () => void
  // 注册无效回调函数
  const onInvalidate: InvalidateCbRegistrator = (fn: () => void) => {
    // 执行 onInvalidate 的时候，就是注册了一个 cleanup 和 runner 的 onStop 方法，这个方法内部会执行 fn，也就是你注册的无效回调函数。

    // 也就是说当响应式数据发生变化，会执行 cleanup 方法，当 watcher 被停止，会执行 onStop 方法，这两者都会执行注册的无效回调函数 fn。

    // 通过这种方式，Vue.js 就很好地实现了 watcher 注册无效回调函数的需求。
    cleanup = runner.options.onStop = () => {
      callWithErrorHandling(fn, instance, ErrorCodes.WATCH_CLEANUP)
    }
  }

  // in SSR there is no need to setup an actual effect, and it should be noop
  // unless it's eager
  if (__NODE_JS__ && isInSSRComponentSetup) {
    if (!cb) {
      getter()
    } else if (immediate) {
      callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
        getter(),
        undefined,
        onInvalidate
      ])
    }
    return NOOP
  }
   // 旧值初始值
  let oldValue = isArray(source) ? [] : INITIAL_WATCHER_VALUE
  // 回调函数
  const applyCb = cb
    ? () => {
        // 组件销毁，则直接返回
        if (instance && instance.isUnmounted) {
          return
        }
        // 求得新值
        const newValue = runner()
        if (deep || hasChanged(newValue, oldValue)) {
          // cleanup before running cb again
          // 执行清理函数
          if (cleanup) {
            cleanup()
          }
          callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
            newValue,
            // pass undefined as the old value when it's changed for the first time
            // 第一次更改时传递旧值为 undefined
            oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
            onInvalidate
          ])
          // 更新旧值
          oldValue = newValue
        }
      }
    : void 0

  let scheduler: (job: () => any) => void
  if (flush === 'sync') {
    // 同步
    scheduler = invoke
  } else if (flush === 'pre') {
    scheduler = job => {
      if (!instance || instance.isMounted) {
        // 进入异步队列，组件更新前执行
        queueJob(job)
      } else {
        // with 'pre' option, the first call must happen before
        // the component is mounted so it is called synchronously.
        // 如果组件还没挂载，则同步执行确保在组件挂载前
        job()
      }
    }
  } else {
     // 进入异步队列，组件更新后执行
     // 在不涉及 suspense 的情况下，queuePostRenderEffect 相当于 queuePostFlushCb，
    scheduler = job => queuePostRenderEffect(job, instance && instance.suspense)
  }

  const runner = effect(getter, {
    // 延时执行
    lazy: true,
    // so it runs before component update effects in pre flush mode
    // computed effect 可以优先于普通的 effect 先运行，比如组件渲染的 effect
    computed: true,
    onTrack,
    onTrigger,
    scheduler: applyCb ? () => scheduler(applyCb) : scheduler
  })
   // 在组件实例中记录这个 effect
  recordInstanceBoundEffect(runner)

  // initial run
  // 初次执行
  if (applyCb) {
    if (immediate) {
      applyCb()
    } else {
      // 求旧值
      oldValue = runner()
    }
  } else {
    // 没有 cb 的情况
    runner()
  }
  // 最后，会返回侦听器销毁函数，也就是 watch API 执行后返回的函数。我们可以通过调用它来停止 watcher 对数据的侦听。
  return () => {
    stop(runner)
    if (instance) {
      // 移除组件 effects 对这个 runner 的引用
      remove(instance.effects!, runner)
    }
  }
}

// this.$watch
export function instanceWatch(
  this: ComponentInternalInstance,
  source: string | Function,
  cb: Function,
  options?: WatchOptions
): StopHandle {
  const publicThis = this.proxy as any
  const getter = isString(source)
    ? () => publicThis[source]
    : source.bind(publicThis)
  const stop = watch(getter, cb.bind(publicThis), options)
  onBeforeUnmount(stop, this)
  return stop
}
/**
 * @description
 * deep 为true 递归遍历getter去访问value的每一个子属性
 * @param value
 * @param seen
 */
function traverse(value: unknown, seen: Set<unknown> = new Set()) {
  if (!isObject(value) || seen.has(value)) {
    return value
  }
  seen.add(value)
  if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], seen)
    }
  } else if (value instanceof Map) {
    value.forEach((v, key) => {
      // to register mutation dep for existing keys
      traverse(value.get(key), seen)
    })
  } else if (value instanceof Set) {
    value.forEach(v => {
      traverse(v, seen)
    })
  } else {
    for (const key in value) {
      traverse(value[key], seen)
    }
  }
  return value
}
