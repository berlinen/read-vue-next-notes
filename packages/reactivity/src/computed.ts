import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}
/**
 * @description
 * 自动计算属性
 * 1. 标准化参数，
 * 一个是 getter 函数，一个是拥有 getter 和 setter 函数的对象，通过判断参数的类型，我们初始化了函数内部定义的 getter 和 setter 函数。
 * 2. 创建副作用函数
 * 它是对 getter 函数做的一层封装，另外我们这里要注意第二个参数，也就是 effect 函数的配置对象。
 *
 * 其中 lazy 为 true 表示 effect 函数返回的 runner 并不会立即执行
 *
 * computed 为 true 用于表示这是一个 computed effect，
 *
 * scheduler 表示它的调度运行的方式，
 *
 * 3. 创建 computed 对象
 *
 * 这个对象也拥有 getter 和 setter 函数。
 * 当 computed 对象被访问的时候会触发 getter，然后会判断是否 dirty，如果是就执行 runner，然后做依赖收集；
 * 当我们直接设置 computed 对象时会触发 setter，即执行 computed 函数内部定义的 setter 函数。
 *
 * @explain 计算属性的运行机制
 *
 * 第一个 dirty 表示一个计算属性的值是否是“脏的”，用来判断需不需要重新计算，
 * 第二个 value 表示计算属性每次计算后的结果。
 *
 * @param getter
 */
export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  // getter函数
  let getter: ComputedGetter<T>
  // setter函数
  let setter: ComputedSetter<T>
  // 标准化参数
  if (isFunction(getterOrOptions)) {
    // 表面传入的是 getter 函数，不能修改计算属性的值
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }
  // 数据是否脏的
  let dirty = true
  // 计算结果
  let value: T
  let computed: ComputedRef<T>
  // 创建副作用函数
  const runner = effect(getter, {
    // 延时执行
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    // 标记这是一个 computed effect 用于在 trigger 阶段的优先级排序
    computed: true,
    // 调度执行的实现
    scheduler: () => {
      if (!dirty) {
        dirty = true
        // 派发通知，通知运行访问该计算属性的 activeEffect
        trigger(computed, TriggerOpTypes.SET, 'value')
      }
    }
  })
  // 创建 computed 对象
  computed = {
    _isRef: true,
    // expose effect so computed can be stopped
     // 暴露 effect 对象以便计算属性可以停止计算
    effect: runner,
    // 组件渲染阶段会执行
    get value() {
      // 计算属性的 getter
      if (dirty) {
        // 只有数据为脏的时候才会重新计算
        value = runner()
        dirty = false
      }
      // 依赖收集，收集运行访问该计算属性的 activeEffect
      track(computed, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newValue: T) {
       // 计算属性的 setter
      setter(newValue)
    }
  } as any
  return computed
}
