import { Data } from '../component'
import { Slots } from '../componentSlots'
import {
  VNodeArrayChildren,
  openBlock,
  createBlock,
  Fragment,
  VNode
} from '../vnode'
import { PatchFlags } from '@vue/shared'
import { warn } from '../warning'
/**
 * @description
 * 渲染slot内容
 * 1. 根据第二个参数 name 获取对应的插槽函数 slot
 * 2. 通过 createBlock 创建了 vnode 节点，注意，它的类型是一个 Fragment，children 是执行 slot 插槽函数的返回值。
 * @param slots 参数 slots 就是 instance.slots
 * @param name
 * @param props
 * @param fallback
 */
export function renderSlot(
  slots: Slots,
  name: string,
  props: Data = {},
  // this is not a user-facing function, so the fallback is always generated by
  // the compiler and guaranteed to be a function returning an array
  fallback?: () => VNodeArrayChildren
): VNode {
  let slot = slots[name]

  if (__DEV__ && slot && slot.length > 1) {
    warn(
      `SSR-optimized slot function detected in a non-SSR-optimized render ` +
        `function. You need to mark this component with $dynamic-slots in the ` +
        `parent template.`
    )
    slot = () => []
  }

  return (
    openBlock(),
    createBlock(
      Fragment,
      { key: props.key },
      slot ? slot(props) : fallback ? fallback() : [],
      slots._ ? PatchFlags.STABLE_FRAGMENT : PatchFlags.BAIL
    )
  )
}
