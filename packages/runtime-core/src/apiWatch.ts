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
 * 3. 创建 scheduler 时序执行函数
 * 4. 创建 effect 副作用函数
 * 5. 返回侦听器销毁函数
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
    // no cb -> simple effect
    getter = () => {
      if (instance && instance.isUnmounted) {
        return
      }
      if (cleanup) {
        cleanup()
      }
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
  const onInvalidate: InvalidateCbRegistrator = (fn: () => void) => {
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

  let oldValue = isArray(source) ? [] : INITIAL_WATCHER_VALUE
  const applyCb = cb
    ? () => {
        if (instance && instance.isUnmounted) {
          return
        }
        const newValue = runner()
        if (deep || hasChanged(newValue, oldValue)) {
          // cleanup before running cb again
          if (cleanup) {
            cleanup()
          }
          callWithAsyncErrorHandling(cb, instance, ErrorCodes.WATCH_CALLBACK, [
            newValue,
            // pass undefined as the old value when it's changed for the first time
            oldValue === INITIAL_WATCHER_VALUE ? undefined : oldValue,
            onInvalidate
          ])
          oldValue = newValue
        }
      }
    : void 0

  let scheduler: (job: () => any) => void
  if (flush === 'sync') {
    scheduler = invoke
  } else if (flush === 'pre') {
    scheduler = job => {
      if (!instance || instance.isMounted) {
        queueJob(job)
      } else {
        // with 'pre' option, the first call must happen before
        // the component is mounted so it is called synchronously.
        job()
      }
    }
  } else {
    scheduler = job => queuePostRenderEffect(job, instance && instance.suspense)
  }

  const runner = effect(getter, {
    lazy: true,
    // so it runs before component update effects in pre flush mode
    computed: true,
    onTrack,
    onTrigger,
    scheduler: applyCb ? () => scheduler(applyCb) : scheduler
  })

  recordInstanceBoundEffect(runner)

  // initial run
  if (applyCb) {
    if (immediate) {
      applyCb()
    } else {
      oldValue = runner()
    }
  } else {
    runner()
  }

  return () => {
    stop(runner)
    if (instance) {
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
