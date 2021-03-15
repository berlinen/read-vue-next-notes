import {
  Text,
  Fragment,
  Comment,
  cloneIfMounted,
  normalizeVNode,
  VNode,
  VNodeArrayChildren,
  createVNode,
  isSameVNodeType,
  Static,
  VNodeNormalizedRef,
  VNodeHook
} from './vnode'
import {
  ComponentInternalInstance,
  createComponentInstance,
  Data,
  setupComponent
} from './component'
import {
  renderComponentRoot,
  shouldUpdateComponent,
  updateHOCHostEl
} from './componentRenderUtils'
import {
  isString,
  EMPTY_OBJ,
  EMPTY_ARR,
  isReservedProp,
  isFunction,
  PatchFlags,
  ShapeFlags,
  NOOP,
  hasOwn,
  invokeArrayFns
} from '@vue/shared'
import {
  queueJob,
  queuePostFlushCb,
  flushPostFlushCbs,
  invalidateJob
} from './scheduler'
import { effect, stop, ReactiveEffectOptions, isRef } from '@vue/reactivity'
import { updateProps } from './componentProps'
import { updateSlots } from './componentSlots'
import { pushWarningContext, popWarningContext, warn } from './warning'
import { ComponentPublicInstance } from './componentProxy'
import { createAppAPI, CreateAppFunction } from './apiCreateApp'
import {
  SuspenseBoundary,
  queueEffectWithSuspense,
  SuspenseImpl
} from './components/Suspense'
import { TeleportImpl } from './components/Teleport'
import { isKeepAlive, KeepAliveContext } from './components/KeepAlive'
import { registerHMR, unregisterHMR } from './hmr'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { createHydrationFunctions, RootHydrateFunction } from './hydration'
import { invokeDirectiveHook } from './directives'
import { startMeasure, endMeasure } from './profiling'

export interface Renderer<HostElement = any> {
  render: RootRenderFunction<HostElement>
  createApp: CreateAppFunction<HostElement>
}

export interface HydrationRenderer extends Renderer<Element> {
  hydrate: RootHydrateFunction
}

export type RootRenderFunction<HostElement = RendererElement> = (
  vnode: VNode | null,
  container: HostElement
) => void

export interface RendererOptions<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  patchProp(
    el: HostElement,
    key: string,
    prevValue: any,
    nextValue: any,
    isSVG?: boolean,
    prevChildren?: VNode<HostNode, HostElement>[],
    parentComponent?: ComponentInternalInstance | null,
    parentSuspense?: SuspenseBoundary | null,
    unmountChildren?: UnmountChildrenFn
  ): void
  insert(el: HostNode, parent: HostElement, anchor?: HostNode | null): void
  remove(el: HostNode): void
  createElement(
    type: string,
    isSVG?: boolean,
    isCustomizedBuiltIn?: string
  ): HostElement
  createText(text: string): HostNode
  createComment(text: string): HostNode
  setText(node: HostNode, text: string): void
  setElementText(node: HostElement, text: string): void
  parentNode(node: HostNode): HostElement | null
  nextSibling(node: HostNode): HostNode | null
  querySelector?(selector: string): HostElement | null
  setScopeId?(el: HostElement, id: string): void
  cloneNode?(node: HostNode): HostNode
  insertStaticContent?(
    content: string,
    parent: HostElement,
    anchor: HostNode | null,
    isSVG: boolean
  ): HostElement
}

// Renderer Node can technically be any object in the context of core renderer
// logic - they are never directly operated on and always passed to the node op
// functions provided via options, so the internal constraint is really just
// a generic object.
export interface RendererNode {
  [key: string]: any
}

export interface RendererElement extends RendererNode {}

// An object exposing the internals of a renderer, passed to tree-shakeable
// features so that they can be decoupled from this file. Keys are shortened
// to optimize bundle size.
export interface RendererInternals<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  p: PatchFn
  um: UnmountFn
  r: RemoveFn
  m: MoveFn
  mt: MountComponentFn
  mc: MountChildrenFn
  pc: PatchChildrenFn
  pbc: PatchBlockChildrenFn
  n: NextFn
  o: RendererOptions<HostNode, HostElement>
}

// These functions are created inside a closure and therefore their types cannot
// be directly exported. In order to avoid maintaining function signatures in
// two places, we declare them once here and use them inside the closure.
type PatchFn = (
  n1: VNode | null, // null means this is a mount
  n2: VNode,
  container: RendererElement,
  anchor?: RendererNode | null,
  parentComponent?: ComponentInternalInstance | null,
  parentSuspense?: SuspenseBoundary | null,
  isSVG?: boolean,
  optimized?: boolean
) => void

type MountChildrenFn = (
  children: VNodeArrayChildren,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean,
  start?: number
) => void

type PatchChildrenFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized?: boolean
) => void

type PatchBlockChildrenFn = (
  oldChildren: VNode[],
  newChildren: VNode[],
  fallbackContainer: RendererElement,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean
) => void

type MoveFn = (
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  type: MoveType,
  parentSuspense?: SuspenseBoundary | null
) => void

type NextFn = (vnode: VNode) => RendererNode | null

type UnmountFn = (
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean
) => void

type RemoveFn = (vnode: VNode) => void

type UnmountChildrenFn = (
  children: VNode[],
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  start?: number
) => void

export type MountComponentFn = (
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

type ProcessTextOrCommentFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null
) => void

export type SetupRenderEffectFn = (
  instance: ComponentInternalInstance,
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

export const enum MoveType {
  ENTER,
  LEAVE,
  REORDER
}

const prodEffectOptions = {
  scheduler: queueJob
}

function createDevEffectOptions(
  instance: ComponentInternalInstance
): ReactiveEffectOptions {
  // onRenderTracked 和 onRenderTriggered 注册的钩子函数，原来是在副作用渲染函数的 onTrack 和 onTrigger 对应的函数中执行的。
  return {
    scheduler: queueJob,
    onTrack: instance.rtc ? e => invokeArrayFns(instance.rtc!, e) : void 0,
    onTrigger: instance.rtg ? e => invokeArrayFns(instance.rtg!, e) : void 0
  }
}
// 在不涉及 suspense 的情况下，queuePostRenderEffect 相当于 queuePostFlushCb
export const queuePostRenderEffect = __FEATURE_SUSPENSE__
  ? queueEffectWithSuspense
  : queuePostFlushCb

/**
 * The createRenderer function accepts two generic arguments:
 * HostNode and HostElement, corresponding to Node and Element types in the
 * host environment. For example, for runtime-dom, HostNode would be the DOM
 * `Node` interface and HostElement would be the DOM `Element` interface.
 *
 * Custom renderers can pass in the platform specific types like this:
 *
 * ``` js
 * const { render, createApp } = createRenderer<Node, Element>({
 *   patchProp,
 *   ...nodeOps
 * })
 * ```
 */
export function createRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>) {
  return baseCreateRenderer<HostNode, HostElement>(options)
}

// Separate API for creating hydration-enabled renderer.
// Hydration logic is only used when calling this function, making it
// tree-shakable.
export function createHydrationRenderer(
  options: RendererOptions<Node, Element>
) {
  return baseCreateRenderer(options, createHydrationFunctions)
}

// overload 1: no hydration
function baseCreateRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement>

// overload 2: with hydration
function baseCreateRenderer(
  options: RendererOptions<Node, Element>,
  createHydrationFns: typeof createHydrationFunctions
): HydrationRenderer

// implementation 组件渲染的核心逻辑
function baseCreateRenderer(
  options: RendererOptions,
  createHydrationFns?: typeof createHydrationFunctions
): any {
  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
    setScopeId: hostSetScopeId = NOOP,
    cloneNode: hostCloneNode,
    insertStaticContent: hostInsertStaticContent
  } = options

  /**
   * @desc 1 根据vnode挂载dom  2 根据新旧vnode更新dom
   *
   * @param n1 旧的vnode n1 == null 表示是第一次的挂载过程
   * @param n2 新的vnode 会根据这个vnode类型执行不同的处理逻辑
   * @param container 表示Dom容器 也就是vnode渲染生成Dom后 会挂载到container下面
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  // Note: functions inside this closure should use `const xxx = () => {}`
  // style in order to prevent being inlined by minifiers.
  // 创建或者更新组件
  const patch: PatchFn = (
    n1,
    n2,
    container,
    anchor = null,
    parentComponent = null,
    parentSuspense = null,
    isSVG = false,
    optimized = false
  ) => {
    // patching & not same type, unmount old tree
    // 如果存在新旧节点，且新旧节点类型不同，则销毁旧的节点
    // 如果是相同的vnode 类型， 就需要走diff更新流程了，会根据不同的vnode类型执行不同的处理逻辑
    if (n1 && !isSameVNodeType(n1, n2)) {
      anchor = getNextHostNode(n1)
      unmount(n1, parentComponent, parentSuspense, true)
      // 旧的vnode 设置null 保证后续都走 mount 逻辑
      n1 = null
    }

    const { type, ref, shapeFlag } = n2
    switch (type) {
      // 处理文本节点
      case Text:
        processText(n1, n2, container, anchor)
        break
      // 处理注释节点
      case Comment:
        processCommentNode(n1, n2, container, anchor)
        break
      // 处理静态节点
      case Static:
        if (n1 == null) {
          mountStaticNode(n2, container, anchor, isSVG)
        } // static nodes are noop on patch
        break
      // 处理Fragment元素
      case Fragment:
        processFragment(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
        break
      default:
        // shapeFlag & 1
        if (shapeFlag & ShapeFlags.ELEMENT) {
          // 处理普通 DOM 元素
          processElement(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
          // shapeFlag & 6
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          // 处理组件
          processComponent(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
            // shapeFlag & 64
        } else if (shapeFlag & ShapeFlags.TELEPORT) {
           // 处理 TELEPORT
          ;(type as typeof TeleportImpl).process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized,
            internals
          )
           // shapeFlag & 128
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          // 处理 SUSPENSE
          ;(type as typeof SuspenseImpl).process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized,
            internals
          )
        } else if (__DEV__) {
          warn('Invalid VNode type:', type, `(${typeof type})`)
        }
    }

    // set ref
    if (ref != null && parentComponent) {
      const refValue =
        shapeFlag & ShapeFlags.STATEFUL_COMPONENT ? n2.component!.proxy : n2.el
      setRef(ref, n1 && n1.ref, parentComponent, refValue)
    }
  }

  const processText: ProcessTextOrCommentFn = (n1, n2, container, anchor) => {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateText(n2.children as string)),
        container,
        anchor
      )
    } else {
      const el = (n2.el = n1.el!)
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }

  const processCommentNode: ProcessTextOrCommentFn = (
    n1,
    n2,
    container,
    anchor
  ) => {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateComment((n2.children as string) || '')),
        container,
        anchor
      )
    } else {
      // there's no support for dynamic comments
      n2.el = n1.el
    }
  }

  const mountStaticNode = (
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean
  ) => {
    if (n2.el && hostCloneNode !== undefined) {
      hostInsert(hostCloneNode(n2.el), container, anchor)
    } else {
      // static nodes are only present when used with compiler-dom/runtime-dom
      // which guarantees presence of hostInsertStaticContent.
      n2.el = hostInsertStaticContent!(
        n2.children as string,
        container,
        anchor,
        isSVG
      )
    }
  }
  /**
   * @desc 处理普通元素
   * @param n1 新节点
   * @param n2
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  const processElement = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    isSVG = isSVG || (n2.type as string) === 'svg'
    // 是否第一次挂载
    if (n1 == null) {
      // 挂载元素节点
      mountElement(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    } else {
       // 更新元素节点
      patchElement(n1, n2, parentComponent, parentSuspense, isSVG, optimized)
    }
  }
  /**
   * @desc 挂载元素节点
   * 1 创建DOM元素节点 通过 hostCreateElement 方法创建
   * 2 处理props 给节点丰富class style event 等属性 并做相关处理
   * 3 处理children
   * 4 挂载DOM元素到container上
   * @param vnode
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  const mountElement = (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    let el: RendererElement
    let vnodeHook: VNodeHook | undefined | null
    const {
      type,
      props,
      shapeFlag,
      transition,
      scopeId,
      patchFlag,
      dirs
    } = vnode
    if (
      vnode.el &&
      hostCloneNode !== undefined &&
      patchFlag === PatchFlags.HOISTED
    ) {
      // If a vnode has non-null el, it means it's being reused.
      // Only static vnodes can be reused, so its mounted DOM nodes should be
      // exactly the same, and we can simply do a clone here.
      el = vnode.el = hostCloneNode(vnode.el)
    } else {
      // 创建 dom 元素节点
      el = vnode.el = hostCreateElement(
        vnode.type as string,
        isSVG,
        props && props.is
      )
      // props
      if (props) {
        // 处理props 比如 class style event 等属性
        for (const key in props) {
          if (!isReservedProp(key)) {
            hostPatchProp(el, key, null, props[key], isSVG)
          }
        }
        if ((vnodeHook = props.onVnodeBeforeMount)) {
          invokeVNodeHook(vnodeHook, parentComponent, vnode)
        }
      }
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
      }

      // scopeId
      if (scopeId) {
        hostSetScopeId(el, scopeId)
      }
      const treeOwnerId = parentComponent && parentComponent.type.__scopeId
      // vnode's own scopeId and the current patched component's scopeId is
      // different - this is a slot content node.
      if (treeOwnerId && treeOwnerId !== scopeId) {
        hostSetScopeId(el, treeOwnerId + '-s')
      }

      // children
      // shapeFlag & 8 处理子节点是纯文本的情况
      if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        // function setElementText (el, text) {
        //   el.textContent = text;
        // }
        hostSetElementText(el, vnode.children as string)

        // shapeFlag & 16 处理子节点是数组的情况
      } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        mountChildren(
          vnode.children as VNodeArrayChildren,
          el,
          null,
          parentComponent,
          parentSuspense,
          isSVG && type !== 'foreignObject',
          optimized || !!vnode.dynamicChildren
        )
      }
      if (transition && !transition.persisted) {
        transition.beforeEnter(el)
      }
    }
    // 把创建的 DOM 元素节点挂载到 container 上
    // web => hostInsert

    // function insert (child, parent, anchor) {
    // 如果有参考元素 anchor
    //   if(anchor) {
    //     parent.insertBefore(child, anchor)
    //   } else {
    //     parent.appendChild(child)
    //   }
    // }
    hostInsert(el, container, anchor)
    if (
      (vnodeHook = props && props.onVnodeMounted) ||
      (transition && !transition.persisted) ||
      dirs
    ) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        transition && !transition.persisted && transition.enter(el)
        dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
      }, parentSuspense)
    }
  }
  /**
   * @desc 处理子节点是数组，
   * 遍历 children 获取到每一个 child，然后递归执行 patch 方法挂载每一个 child 。
   * 可以看到，mountChildren 函数的第二个参数是 container，而我们调用 mountChildren 方法传入的第二个参数是在 mountElement 时创建的 DOM 节点，这就很好地建立了父子关系。
   * 通过递归 patch 这种深度优先遍历树的方式，我们就可以构造完整的 DOM 树，完成组件的渲染。
   * 最后通过 hostInsert 方法把创建的 DOM 元素节点挂载到 container 上，它在 Web 环境下这样定义：
   * @param children
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   * @param start
   */
  const mountChildren: MountChildrenFn = (
    children,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized,
    start = 0
  ) => {
    for (let i = start; i < children.length; i++) {
      // 预处理child
      const child = (children[i] = optimized
        ? cloneIfMounted(children[i] as VNode)
        : normalizeVNode(children[i]))
      // 递归 patch 挂载child
      // 在 mountChildren 的时候递归执行的是 patch 函数，而不是 mountElement 函数，这是因为子节点可能有其他类型的 vnode，比如组件 vnode。
      patch(
        null,
        child,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    }
  }
  /**
   * @description
   *  更新元素
   * 1 更新 props
   * 2 更新子节点
   * 1 更新 props => patchProps 更新Dom节点的class style event others dom propertys
   * 2 更新子节点 children => patchChildren
   * 如果这个 vnode 是一个 Block vnode，那么我们不用去通过 patchChildren 全量比对，只需要通过 patchBlockChildren 去比对并更新 Block 中的动态子节点即可。
   * @param n1
   * @param n2
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    const el = (n2.el = n1.el!)
    let { patchFlag, dynamicChildren, dirs } = n2
    const oldProps = (n1 && n1.props) || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    let vnodeHook: VNodeHook | undefined | null

    if ((vnodeHook = newProps.onVnodeBeforeUpdate)) {
      invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
    }
    if (dirs) {
      invokeDirectiveHook(n2, n1, parentComponent, 'beforeUpdate')
    }

    if (__DEV__ && parentComponent && parentComponent.renderUpdated) {
      // HMR updated, force full diff
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    if (patchFlag > 0) {
      // the presence of a patchFlag means this element's render code was
      // generated by the compiler and can take the fast path.
      // in this path old node and new node are guaranteed to have the same shape
      // (i.e. at the exact same position in the source template)
      if (patchFlag & PatchFlags.FULL_PROPS) {
        // element props contain dynamic keys, full diff needed
        // 更新props
        patchProps(
          el,
          n2,
          oldProps,
          newProps,
          parentComponent,
          parentSuspense,
          isSVG
        )
      } else {
        // class
        // this flag is matched when the element has dynamic class bindings.
        if (patchFlag & PatchFlags.CLASS) {
          if (oldProps.class !== newProps.class) {
            hostPatchProp(el, 'class', null, newProps.class, isSVG)
          }
        }

        // style
        // this flag is matched when the element has dynamic style bindings
        if (patchFlag & PatchFlags.STYLE) {
          hostPatchProp(el, 'style', oldProps.style, newProps.style, isSVG)
        }

        // props
        // This flag is matched when the element has dynamic prop/attr bindings
        // other than class and style. The keys of dynamic prop/attrs are saved for
        // faster iteration.
        // Note dynamic keys like :[foo]="bar" will cause this optimization to
        // bail out and go through a full diff because we need to unset the old key
        if (patchFlag & PatchFlags.PROPS) {
          // if the flag is present then dynamicProps must be non-null
          const propsToUpdate = n2.dynamicProps!
          for (let i = 0; i < propsToUpdate.length; i++) {
            const key = propsToUpdate[i]
            const prev = oldProps[key]
            const next = newProps[key]
            if (prev !== next) {
              hostPatchProp(
                el,
                key,
                prev,
                next,
                isSVG,
                n1.children as VNode[],
                parentComponent,
                parentSuspense,
                unmountChildren
              )
            }
          }
        }
      }

      // text
      // This flag is matched when the element has only dynamic text children.
      if (patchFlag & PatchFlags.TEXT) {
        if (n1.children !== n2.children) {
          hostSetElementText(el, n2.children as string)
        }
      }
    } else if (!optimized && dynamicChildren == null) {
      // unoptimized, full diff
       // 更新 props
      patchProps(
        el,
        n2,
        oldProps,
        newProps,
        parentComponent,
        parentSuspense,
        isSVG
      )
    }

    const areChildrenSVG = isSVG && n2.type !== 'foreignObject'
    if (dynamicChildren) {
      patchBlockChildren(
        n1.dynamicChildren!,
        dynamicChildren,
        el,
        parentComponent,
        parentSuspense,
        areChildrenSVG
      )
    } else if (!optimized) {
      // full diff
      // 更新子节点
      patchChildren(
        n1,
        n2,
        el,
        null,
        parentComponent,
        parentSuspense,
        areChildrenSVG
      )
    }

    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
        dirs && invokeDirectiveHook(n2, n1, parentComponent, 'updated')
      }, parentSuspense)
    }
  }
/**
 * @description
 * 比对动态子节点
 *
 * patchBlockChildren 的实现很简单，遍历新的动态子节点数组，拿到对应的新旧动态子节点，并执行 patch 更新子节点即可。
 *
 * 更新的复杂度就变成和动态节点的数量正相关，而不与模板大小正相关，如果一个模板的动静比越低，那么性能优化的效果就越明显。
 * @param oldChildren
 * @param newChildren
 * @param fallbackContainer
 * @param parentComponent
 * @param parentSuspense
 * @param isSVG
 */
  // The fast path for blocks.
  const patchBlockChildren: PatchBlockChildrenFn = (
    oldChildren,
    newChildren,
    fallbackContainer,
    parentComponent,
    parentSuspense,
    isSVG
  ) => {
    for (let i = 0; i < newChildren.length; i++) {
      const oldVNode = oldChildren[i]
      const newVNode = newChildren[i]
      // Determine the container (parent element) for the patch.
      // 确定待更新节点的容器
      const container =
        // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        // 对于 Fragment，我们需要提供正确的父容器
        oldVNode.type === Fragment ||
        // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        // 在不同节点的情况下，将有一个替换节点，我们也需要正确的父容器
        !isSameVNodeType(oldVNode, newVNode) ||
        // - In the case of a component, it could contain anything.
        // 组件的情况，我们也需要提供一个父容器
        oldVNode.shapeFlag & ShapeFlags.COMPONENT
          ? hostParentNode(oldVNode.el!)!
          : // In other cases, the parent container is not actually used so we
            // just pass the block element here to avoid a DOM parentNode call.
            // 在其他情况下，父容器实际上并没有被使用，所以这里只传递 Block 元素即可
            fallbackContainer
      patch(
        oldVNode,
        newVNode,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        true
      )
    }
  }

  const patchProps = (
    el: RendererElement,
    vnode: VNode,
    oldProps: Data,
    newProps: Data,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean
  ) => {
    if (oldProps !== newProps) {
      for (const key in newProps) {
        if (isReservedProp(key)) continue
        const next = newProps[key]
        const prev = oldProps[key]
        if (next !== prev) {
          hostPatchProp(
            el,
            key,
            prev,
            next,
            isSVG,
            vnode.children as VNode[],
            parentComponent,
            parentSuspense,
            unmountChildren
          )
        }
      }
      if (oldProps !== EMPTY_OBJ) {
        for (const key in oldProps) {
          if (!isReservedProp(key) && !(key in newProps)) {
            hostPatchProp(
              el,
              key,
              oldProps[key],
              null,
              isSVG,
              vnode.children as VNode[],
              parentComponent,
              parentSuspense,
              unmountChildren
            )
          }
        }
      }
    }
  }

  const processFragment = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateText(''))!
    const fragmentEndAnchor = (n2.anchor = n1 ? n1.anchor : hostCreateText(''))!

    let { patchFlag, dynamicChildren } = n2
    if (patchFlag > 0) {
      optimized = true
    }

    if (__DEV__ && parentComponent && parentComponent.renderUpdated) {
      // HMR updated, force full diff
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    if (n1 == null) {
      hostInsert(fragmentStartAnchor, container, anchor)
      hostInsert(fragmentEndAnchor, container, anchor)
      // a fragment can only have array children
      // since they are either generated by the compiler, or implicitly created
      // from arrays.
      mountChildren(
        n2.children as VNodeArrayChildren,
        container,
        fragmentEndAnchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    } else {
      if (patchFlag & PatchFlags.STABLE_FRAGMENT && dynamicChildren) {
        // a stable fragment (template root or <template v-for>) doesn't need to
        // patch children order, but it may contain dynamicChildren.
        patchBlockChildren(
          n1.dynamicChildren!,
          dynamicChildren,
          container,
          parentComponent,
          parentSuspense,
          isSVG
        )
      } else {
        // keyed / unkeyed, or manual fragments.
        // for keyed & unkeyed, since they are compiler generated from v-for,
        // each child is guaranteed to be a block so the fragment will never
        // have dynamicChildren.
        patchChildren(
          n1,
          n2,
          container,
          fragmentEndAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    }
  }

  const processComponent = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    if (n1 == null) {
      if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).activate(
          n2,
          container,
          anchor,
          isSVG,
          optimized
        )
      } else {
        // 挂载组件
        mountComponent(
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    } else {
       // 更新组件
      updateComponent(n1, n2, parentComponent, optimized)
    }
  }
  /**
   * @desc 1 创建组件实例 2 设置组件实例 3 设置并运行待带副作用的渲染函数
   * 内部通过对象的方式去创建了当前渲染的组件实例
   * 设置组件实例子
   * instance保留了许多组件相关的数据，维护了组件的上下文，包括对props，插槽以及其他实例的属性的初始化处理
   * @param initialVNode
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  const mountComponent: MountComponentFn = (
    initialVNode,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    // 创建组件实例
    const instance: ComponentInternalInstance = (initialVNode.component = createComponentInstance(
      initialVNode,
      parentComponent,
      parentSuspense
    ))

    if (__DEV__ && instance.type.__hmrId) {
      registerHMR(instance)
    }

    if (__DEV__) {
      pushWarningContext(initialVNode)
      startMeasure(instance, `mount`)
    }

    // inject renderer internals for keepAlive
    if (isKeepAlive(initialVNode)) {
      ;(instance.ctx as KeepAliveContext).renderer = internals
    }

    // resolve props and slots for setup context
    if (__DEV__) {
      startMeasure(instance, `init`)
    }
    // 设置组件实例
    setupComponent(instance)
    if (__DEV__) {
      endMeasure(instance, `init`)
    }

    // setup() is async. This component relies on async logic to be resolved
    // before proceeding
    if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
      if (!parentSuspense) {
        if (__DEV__) warn('async setup() is used without a suspense boundary!')
        return
      }

      parentSuspense.registerDep(instance, setupRenderEffect)

      // Give it a placeholder if this is not hydration
      if (!initialVNode.el) {
        const placeholder = (instance.subTree = createVNode(Comment))
        processCommentNode(null, placeholder, container!, anchor)
      }
      return
    }
    // 设置并运行带副作用的渲染函数
    setupRenderEffect(
      instance,
      initialVNode,
      container,
      anchor,
      parentSuspense,
      isSVG,
      optimized
    )

    if (__DEV__) {
      popWarningContext()
      endMeasure(instance, `mount`)
    }
  }

  const updateComponent = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    optimized: boolean
  ) => {
    const instance = (n2.component = n1.component)!
    if (shouldUpdateComponent(n1, n2, parentComponent, optimized)) {
      if (
        __FEATURE_SUSPENSE__ &&
        instance.asyncDep &&
        !instance.asyncResolved
      ) {
        // async & still pending - just update props and slots
        // since the component's reactive effect for render isn't set-up yet
        if (__DEV__) {
          pushWarningContext(n2)
        }
        updateComponentPreRender(instance, n2, optimized)
        if (__DEV__) {
          popWarningContext()
        }
        return
      } else {
        // normal update
        instance.next = n2
        // in case the child component is also queued, remove it to avoid
        // double updating the same child component in the same flush.
        // 避免子组件由于自身数据变化导致的重复更新
        invalidateJob(instance.update)
        // instance.update is the reactive effect runner.
        // 执行子组件的副作用渲染函数
        instance.update() // 来主动触发子组件的更新
      }
    } else {
      // no update needed. just copy over properties
      n2.component = n1.component
      n2.el = n1.el
    }
  }
  /**
   * @desc 该函数利用响应式库的 effect 函数创建了一个副作用渲染函数 componentEffect
   * 副作用，这里你可以简单地理解为，当组件的数据发生变化时，effect 函数包裹的内部渲染函数 componentEffect 会重新执行一遍，从而达到重新渲染组件的目的。
   * 渲染函数内部也会判断这是一次初始渲染还是组件更新。
   * 初始渲染 1 把渲染组件生成subtree 2 把subtree挂载到container 中
   * 组件更新 1 更新组件 vnode 节点 2 渲染新的子树vnode  3 根据新旧子树vnode执行patch逻辑
   *
   * @notice
   * 1 渲染组件生成vnode 它也是一个vnode对象
   *
   * 2 更新
   *  更新组件vnode 判断组件实例是否有新的组件 vnode 用 next 来表示
   *  有 则更新组件vnode 没有 next 指向之前组件的 vnode
   *
   *  渲染新的子树 vnode， 因为数据发生变化， 模版和数据相关 渲染生成的子树 vnode 也会发生相应的变化
   *
   *  核心 patch 找出新旧子树 vnode 的不同， 并找到一种合适的方式更新DOM
   *
   *  vue3 subtree 和 initialVnode 对应  vue2 _vnode 和 $vnode
   * @param instance
   * @param initialVNode
   * @param container
   * @param anchor
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  const setupRenderEffect: SetupRenderEffectFn = (
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    // 创建响应式的副作用渲染函数
    // create reactive effect for rendering
    instance.update = effect(function componentEffect() {
      // 初次渲染
      if (!instance.isMounted) {
        // 渲染组件
        let vnodeHook: VNodeHook | null | undefined
        const { el, props } = initialVNode
        const { bm, m, a, parent } = instance
        if (__DEV__) {
          startMeasure(instance, `render`)
        }
        // 渲染组件生成子树 vnode
        const subTree = (instance.subTree = renderComponentRoot(instance))
        if (__DEV__) {
          endMeasure(instance, `render`)
        }
        // beforeMount hook
        if (bm) {
          invokeArrayFns(bm)
        }
        // onVnodeBeforeMount
        if ((vnodeHook = props && props.onVnodeBeforeMount)) {
          invokeVNodeHook(vnodeHook, parent, initialVNode)
        }
        if (el && hydrateNode) {
          if (__DEV__) {
            startMeasure(instance, `hydrate`)
          }
          // vnode has adopted host node - perform hydration instead of mount.
          hydrateNode(
            initialVNode.el as Node,
            subTree,
            instance,
            parentSuspense
          )
          if (__DEV__) {
            endMeasure(instance, `hydrate`)
          }
        } else {
          if (__DEV__) {
            startMeasure(instance, `patch`)
          }
          // 把子树 vnode 挂载到 container 中
          patch(
            null,
            subTree,
            container,
            anchor,
            instance,
            parentSuspense,
            isSVG
          )
          if (__DEV__) {
            endMeasure(instance, `patch`)
          }
          // 保留渲染生成的子树根 dom 节点
          initialVNode.el = subTree.el
        }
        // mounted hook
        if (m) {
          queuePostRenderEffect(m, parentSuspense)
        }
        // onVnodeMounted
        if ((vnodeHook = props && props.onVnodeMounted)) {
          queuePostRenderEffect(() => {
            invokeVNodeHook(vnodeHook!, parent, initialVNode)
          }, parentSuspense)
        }
        // activated hook for keep-alive roots.
        if (
          a &&
          initialVNode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
        ) {
          queuePostRenderEffect(a, parentSuspense)
        }
        // 子树已经被挂载的标志
        instance.isMounted = true
        // 更新组件
      } else {
        // updateComponent
        // This is triggered by mutation of component's own state (next: null)
        // OR parent calling processComponent (next: VNode)
        //  next 表示新的组件 vnode
        // 数据变化 next = null
        // 子组件需要更新 next = 新的子组件
        let { next, bu, u, parent, vnode } = instance
        let vnodeHook: VNodeHook | null | undefined
        if (__DEV__) {
          pushWarningContext(next || instance.vnode)
        }

        if (next) {
          // 更新组件 vnode 节点信息
          // 更新组件 vnode 节点信息，包括更改组件实例的 vnode 指针、更新 props 和更新插槽等一系列操作
          updateComponentPreRender(instance, next, optimized)
        } else {
          next = vnode
        }
        if (__DEV__) {
          startMeasure(instance, `render`)
        }
        // 渲染新的子树 vnode    instance 更新完vnode的组件实例
        // 它依赖了更新后的组件 vnode 中的 props 和 slots 等数据。
        const nextTree = renderComponentRoot(instance)
        if (__DEV__) {
          endMeasure(instance, `render`)
        }
        // 缓存旧的子树 vnode
        const prevTree = instance.subTree
        // 更新子树 vnode
        instance.subTree = nextTree
        next.el = vnode.el
        // beforeUpdate hook
        if (bu) {
          invokeArrayFns(bu)
        }
        // onVnodeBeforeUpdate
        if ((vnodeHook = next.props && next.props.onVnodeBeforeUpdate)) {
          invokeVNodeHook(vnodeHook, parent, next, vnode)
        }
        // reset refs
        // only needed if previous patch had refs
        if (instance.refs !== EMPTY_OBJ) {
          instance.refs = {}
        }
        if (__DEV__) {
          startMeasure(instance, `patch`)
        }
        // 组件更新核心逻辑，根据新旧子树 vnode 做 patch
        patch(
          prevTree,
          nextTree,
          // parent may have changed if it's in a teleport
          // 如果在 teleport 组件中父节点可能已改变，所以容器直接找旧树 Dom 元素的父节点
          hostParentNode(prevTree.el!)!,
          // anchor may have changed if it's in a fragment
          // 参考节点在 fragment 的情况可能改变， 所以直接找旧树 dom 元素的下一个节点
          getNextHostNode(prevTree),
          instance,
          parentSuspense,
          isSVG
        )
        if (__DEV__) {
          endMeasure(instance, `patch`)
        }
        // 缓存更新后的 DOM 节点
        next.el = nextTree.el
        if (next === null) {
          // self-triggered update. In case of HOC, update parent component
          // vnode el. HOC is indicated by parent instance's subTree pointing
          // to child component's vnode
          updateHOCHostEl(instance, nextTree.el)
        }
        // updated hook
        if (u) {
          queuePostRenderEffect(u, parentSuspense)
        }
        // onVnodeUpdated
        if ((vnodeHook = next.props && next.props.onVnodeUpdated)) {
          queuePostRenderEffect(() => {
            invokeVNodeHook(vnodeHook!, parent, next!, vnode)
          }, parentSuspense)
        }
        if (__DEV__) {
          popWarningContext()
        }
      }
    }, __DEV__ ? createDevEffectOptions(instance) : prodEffectOptions)
  }
  /**
   * @description 组件更新
   * @param instance
   * @param nextVNode
   * @param optimized
   */
  const updateComponentPreRender = (
    instance: ComponentInternalInstance,
    nextVNode: VNode,
    optimized: boolean
  ) => {
    // 新组件 vnode 的 component 属性指向组件实例
    nextVNode.component = instance
    // 旧组件 vnode 的 props 属性
    const prevProps = instance.vnode.props
    // 组件实例的 vnode 属性指向新的组件 vnode
    instance.vnode = nextVNode
    // 清空 next 属性，为了下一次重新渲染准备
    instance.next = null
    // 更新 props
    updateProps(instance, nextVNode.props, prevProps, optimized)
    // 更新 插槽
    updateSlots(instance, nextVNode.children)
  }
  /**
   * @desc
   * patchchildren 更新子节点
   * 1
   * @param n1
   * @param n2
   * @param container
   * @param anchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  const patchChildren: PatchChildrenFn = (
    n1,
    n2,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized = false
  ) => {
    const c1 = n1 && n1.children
    const prevShapeFlag = n1 ? n1.shapeFlag : 0
    const c2 = n2.children

    const { patchFlag, shapeFlag } = n2
    // 子节点有三种情况 文本 数组 空
    if (patchFlag === PatchFlags.BAIL) {
      optimized = false
    }
    // fast path
    if (patchFlag > 0) {
      if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
        // this could be either fully-keyed or mixed (some keyed some not)
        // presence of patchFlag means children are guaranteed to be arrays
        patchKeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
        return
      } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
        // unkeyed
        patchUnkeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
        return
      }
    }

    // children has 3 possibilities: text, array or no children.
    // shapeFlag & 8 文本
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      // text children fast path
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // 数组 -> 文本，则删除之前的节点
        unmountChildren(c1 as VNode[], parentComponent, parentSuspense)
      }
      if (c2 !== c1) {
        // 文本对比不同， 则替换为新的文本
        hostSetElementText(container, c2 as string)
      }
      // 现在的节点是数组 或者 为 空
    } else {
      // 之前的节点是数组
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // prev children was array
        // shapeFlag & 16 数组
        // 新的节点仍然是数组，则做完整的 diff
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // two arrays, cannot assume anything, do full diff
          patchKeyedChildren(
            c1 as VNode[],
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
          // 数组 -> 空 则仅仅删除之前的节点
        } else {
          // no new children, just unmount old
          // 数组 -> 空 则仅仅删除之前的节点
          unmountChildren(c1 as VNode[], parentComponent, parentSuspense, true)
        }
      } else {
        // prev children was text OR null
        // new children is array OR null
        // 之前的子节点是文本节点或者为空
        // 新的子节点是数组或者为空

        if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
          // 如果之前节点是文本，则清空
          hostSetElementText(container, '')
        }
        // mount new if array
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // 如果新的节点是数组， 则挂载新的子节点
          mountChildren(
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
        }
      }
    }
  }

  const patchUnkeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    c1 = c1 || EMPTY_ARR
    c2 = c2 || EMPTY_ARR
    const oldLength = c1.length
    const newLength = c2.length
    const commonLength = Math.min(oldLength, newLength)
    let i
    for (i = 0; i < commonLength; i++) {
      const nextChild = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      patch(
        c1[i],
        nextChild,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    }
    if (oldLength > newLength) {
      // remove old
      unmountChildren(c1, parentComponent, parentSuspense, true, commonLength)
    } else {
      // mount new
      mountChildren(
        c2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized,
        commonLength
      )
    }
  }
  /**
   * @description
   * patchkeychildren
   * 整个diff 过程需要维护 头部的索引i 旧节点的尾部索引e1 新节点的尾部索引e2
   * 同步头部节点就是从头部开始，依次对比新节点和旧节点，如果它们相同的则执行 patch 更新节点；如果不同或者索引 i 大于索引 e1 或者 e2，则同步过程结束。
   * @param c1
   * @param c2
   * @param container
   * @param parentAnchor
   * @param parentComponent
   * @param parentSuspense
   * @param isSVG
   * @param optimized
   */
  // can be all-keyed or mixed
  const patchKeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    parentAnchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    let i = 0
    const l2 = c2.length
    // 旧的子节点尾部索引
    let e1 = c1.length - 1 // prev ending index
    // 新的节点的尾部索引
    let e2 = l2 - 1 // next ending index

    // 1. sync from start
    // (a b) c
    // (a b) d e
    // 从头部开始
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      if (isSameVNodeType(n1, n2)) {
        // 相同的节点，递归执行patch 更新节点
        patch(
          n1,
          n2,
          container,
          parentAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      } else {
        break
      }
      i++
    }

    // 2. sync from end
    // a (b c)
    // d e (b c)
    // 同步尾部节点
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1]
      const n2 = (c2[e2] = optimized
        ? cloneIfMounted(c2[e2] as VNode)
        : normalizeVNode(c2[e2]))
      // 相同的节点，递归执行patch 更新节点
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          parentAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      } else {
        break
      }
      e1--
      e2--
    }

    // 3. common sequence + mount
    // (a b)
    // (a b) c
    // i = 2, e1 = 1, e2 = 2
    // (a b)
    // c (a b)
    // i = 0, e1 = -1, e2 = 0
    // 添加新的节点
    // 首先要判断新子节点是否有剩余的情况，如果满足则添加新子节点
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1
        const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
        while (i <= e2) {
          // 挂载新的节点
          patch(
            null,
            (c2[i] = optimized
              ? cloneIfMounted(c2[i] as VNode)
              : normalizeVNode(c2[i])),
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG
          )
          i++
        }
      }
    }

    // 4. common sequence + unmount
    // (a b) c
    // (a b)
    // i = 2, e1 = 2, e2 = 1
    // a (b c)
    // (b c)
    // i = 0, e1 = 0, e2 = -1
    // 旧子节点有剩余要删除的多余节点
    else if (i > e2) {
      while (i <= e1) {
        // 删除节点
        unmount(c1[i], parentComponent, parentSuspense, true)
        i++
      }
    }

    // 5. unknown sequence
    // [i ... e1 + 1]: a b [c d e] f g
    // [i ... e2 + 1]: a b [e d c h] f g
    // i = 2, e1 = 4, e2 = 5
    else {
      const s1 = i // prev starting index  旧子序列开始索引，从 i 开始记录
      const s2 = i // next starting index 新子序列开始索引，从 i 开始记录

      // 5.1 build key:index map for newChildren
      // 根据 key 建立新子序列的索引图
      // 我们认为 key 相同的就是同一个节点，直接执行 patch 更新即可。
      const keyToNewIndexMap: Map<string | number, number> = new Map()
      for (i = s2; i <= e2; i++) {
        const nextChild = (c2[i] = optimized
          ? cloneIfMounted(c2[i] as VNode)
          : normalizeVNode(c2[i]))
        if (nextChild.key != null) {
          if (__DEV__ && keyToNewIndexMap.has(nextChild.key)) {
            warn(
              `Duplicate keys found during update:`,
              JSON.stringify(nextChild.key),
              `Make sure keys are unique.`
            )
          }
          // 遍历新子序列，把节点的 key 和 index 添加到这个 Map 中
          keyToNewIndexMap.set(nextChild.key, i)
        }
      }

      // 5.2 loop through old children left to be patched and try to patch
      // matching nodes & remove nodes that are no longer present
      let j
      // 新子序列已更新节点的数量
      let patched = 0
      // 新子序列待更新节点的数量，等于新子序列的长度
      const toBePatched = e2 - s2 + 1
      // 是否存在要移动的节点
      let moved = false
      // used to track whether any node has moved
       // 用于跟踪判断是否有节点移动
       // maxNewIndexSoFar 始终存储的是上次求值的 newIndex，一旦本次求值的 newIndex 小于 maxNewIndexSoFar，这说明顺序遍历旧子序列的节点在新子序列中的索引并不是一直递增的，也就说明存在移动的情况。
      let maxNewIndexSoFar = 0
      // works as Map<newIndex, oldIndex>
      // Note that oldIndex is offset by +1
      // and oldIndex = 0 is a special value indicating the new node has
      // no corresponding old node.
      // used for determining longest stable subsequence
      // 这个数组存储新子序列中的元素在旧子序列节点的索引，用于确定最长递增子序列
      const newIndexToOldIndexMap = new Array(toBePatched)
      // 初始化数组，每个元素的值都是 0
      // 0 是一个特殊的值，如果遍历完了仍有元素的值为 0，则说明这个新节点没有对应的旧节点
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0
      // 正序遍历旧子序列
      for (i = s1; i <= e1; i++) {
        // 拿到每一个旧子序列节点
        const prevChild = c1[i]
        if (patched >= toBePatched) {
          // all new children have been patched so this can only be a removal
          // 所有新的子序列节点都已经更新，剩余的节点删除
          unmount(prevChild, parentComponent, parentSuspense, true)
          continue
        }
        // 查找旧子序列中的节点在新子序列中的索引
        let newIndex
        if (prevChild.key != null) {
          newIndex = keyToNewIndexMap.get(prevChild.key)
        } else {
          // key-less node, try to locate a key-less node of the same type
          for (j = s2; j <= e2; j++) {
            if (
              newIndexToOldIndexMap[j - s2] === 0 &&
              isSameVNodeType(prevChild, c2[j] as VNode)
            ) {
              newIndex = j
              break
            }
          }
        }
        // 找不到说明旧子序列已经不存在于新子序列中，则删除该节点
        if (newIndex === undefined) {
          unmount(prevChild, parentComponent, parentSuspense, true)
        } else {
           // 更新新子序列中的元素在旧子序列中的索引，这里加 1 偏移，是为了避免 i 为 0 的特殊情况，影响对后续最长递增子序列的求解
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          // maxNewIndexSoFar 始终存储的是上次求值的 newIndex，如果不是一直递增，则说明有移动
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex
          } else {
            moved = true
          }
          // 更新新旧子序列中匹配的节点
          patch(
            prevChild,
            c2[newIndex] as VNode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
          patched++
        }
      }

      // 5.3 move and mount
      // generate longest stable subsequence only when nodes have moved
      // 移动和挂载新节点
      // 仅当节点移动时生成最长递增子序列
      const increasingNewIndexSequence = moved
        ? getSequence(newIndexToOldIndexMap)
        : EMPTY_ARR
      // 倒序遍历以便我们可以使用最后更新的节点作为锚点
      j = increasingNewIndexSequence.length - 1
      // looping backwards so that we can use last patched node as anchor
      for (i = toBePatched - 1; i >= 0; i--) {
        const nextIndex = s2 + i
        const nextChild = c2[nextIndex] as VNode
        // 锚点指向上一个更新的节点，如果 nextIndex 超过新子节点的长度，则指向 parentAnchor
        const anchor =
          nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor
        if (newIndexToOldIndexMap[i] === 0) {
          // mount new
          // 挂载新的子节点
          patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG
          )
        } else if (moved) {
          // move if:
          // There is no stable subsequence (e.g. a reverse)
          // OR current node is not among the stable sequence
          // 没有最长递增子序列（reverse 的场景）或者当前的节点索引不在最长递增子序列中，需要移动
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor, MoveType.REORDER)
          } else {
            // 倒序递增子序列
            j--
          }
        }
      }
    }
  }

  const move: MoveFn = (
    vnode,
    container,
    anchor,
    moveType,
    parentSuspense = null
  ) => {
    const { el, type, transition, children, shapeFlag } = vnode
    if (shapeFlag & ShapeFlags.COMPONENT) {
      move(vnode.component!.subTree, container, anchor, moveType)
      return
    }

    if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
      vnode.suspense!.move(container, anchor, moveType)
      return
    }

    if (shapeFlag & ShapeFlags.TELEPORT) {
      ;(type as typeof TeleportImpl).move(vnode, container, anchor, internals)
      return
    }

    if (type === Fragment) {
      hostInsert(el!, container, anchor)
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move((children as VNode[])[i], container, anchor, moveType)
      }
      hostInsert(vnode.anchor!, container, anchor)
      return
    }

    // single nodes
    const needTransition =
      moveType !== MoveType.REORDER &&
      shapeFlag & ShapeFlags.ELEMENT &&
      transition
    if (needTransition) {
      if (moveType === MoveType.ENTER) {
        transition!.beforeEnter(el!)
        hostInsert(el!, container, anchor)
        queuePostRenderEffect(() => transition!.enter(el!), parentSuspense)
      } else {
        const { leave, delayLeave, afterLeave } = transition!
        const remove = () => hostInsert(el!, container, anchor)
        const performLeave = () => {
          leave(el!, () => {
            remove()
            afterLeave && afterLeave()
          })
        }
        if (delayLeave) {
          delayLeave(el!, remove, performLeave)
        } else {
          performLeave()
        }
      }
    } else {
      hostInsert(el!, container, anchor)
    }
  }

  const unmount: UnmountFn = (
    vnode,
    parentComponent,
    parentSuspense,
    doRemove = false
  ) => {
    const { props, ref, children, dynamicChildren, shapeFlag, dirs } = vnode
    const shouldInvokeDirs = shapeFlag & ShapeFlags.ELEMENT && dirs
    let vnodeHook: VNodeHook | undefined | null

    // unset ref
    if (ref != null && parentComponent) {
      setRef(ref, null, parentComponent, null)
    }

    if ((vnodeHook = props && props.onVnodeBeforeUnmount)) {
      invokeVNodeHook(vnodeHook, parentComponent, vnode)
    }

    if (shapeFlag & ShapeFlags.COMPONENT) {
      if (shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
      } else {
        unmountComponent(vnode.component!, parentSuspense, doRemove)
      }
    } else {
      if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
        vnode.suspense!.unmount(parentSuspense, doRemove)
        return
      }

      if (shouldInvokeDirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeUnmount')
      }

      if (dynamicChildren) {
        // fast path for block nodes: only need to unmount dynamic children.
        unmountChildren(dynamicChildren, parentComponent, parentSuspense)
      } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(children as VNode[], parentComponent, parentSuspense)
      }

      // an unmounted teleport should always remove its children
      if (shapeFlag & ShapeFlags.TELEPORT) {
        ;(vnode.type as typeof TeleportImpl).remove(vnode, internals)
      }

      if (doRemove) {
        remove(vnode)
      }
    }

    if ((vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        shouldInvokeDirs &&
          invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
      }, parentSuspense)
    }
  }

  const remove: RemoveFn = vnode => {
    const { type, el, anchor, transition } = vnode
    if (type === Fragment) {
      removeFragment(el!, anchor!)
      return
    }

    const performRemove = () => {
      hostRemove(el!)
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave()
      }
    }

    if (
      vnode.shapeFlag & ShapeFlags.ELEMENT &&
      transition &&
      !transition.persisted
    ) {
      const { leave, delayLeave } = transition
      const performLeave = () => leave(el!, performRemove)
      if (delayLeave) {
        delayLeave(vnode.el!, performRemove, performLeave)
      } else {
        performLeave()
      }
    } else {
      performRemove()
    }
  }

  const removeFragment = (cur: RendererNode, end: RendererNode) => {
    // For fragments, directly remove all contained DOM nodes.
    // (fragment child nodes cannot have transition)
    let next
    while (cur !== end) {
      next = hostNextSibling(cur)!
      hostRemove(cur)
      cur = next
    }
    hostRemove(end)
  }

  const unmountComponent = (
    instance: ComponentInternalInstance,
    parentSuspense: SuspenseBoundary | null,
    doRemove?: boolean
  ) => {
    if (__DEV__ && instance.type.__hmrId) {
      unregisterHMR(instance)
    }

    const { bum, effects, update, subTree, um, da, isDeactivated } = instance
    // beforeUnmount hook
    if (bum) {
      invokeArrayFns(bum)
    }
    if (effects) {
      for (let i = 0; i < effects.length; i++) {
        stop(effects[i])
      }
    }
    // update may be null if a component is unmounted before its async
    // setup has resolved.
    if (update) {
      stop(update)
      unmount(subTree, instance, parentSuspense, doRemove)
    }
    // unmounted hook
    if (um) {
      queuePostRenderEffect(um, parentSuspense)
    }
    // deactivated hook
    if (
      da &&
      !isDeactivated &&
      instance.vnode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
    ) {
      queuePostRenderEffect(da, parentSuspense)
    }
    queuePostFlushCb(() => {
      instance.isUnmounted = true
    })

    // A component with async dep inside a pending suspense is unmounted before
    // its async dep resolves. This should remove the dep from the suspense, and
    // cause the suspense to resolve immediately if that was the last dep.
    if (
      __FEATURE_SUSPENSE__ &&
      parentSuspense &&
      !parentSuspense.isResolved &&
      !parentSuspense.isUnmounted &&
      instance.asyncDep &&
      !instance.asyncResolved
    ) {
      parentSuspense.deps--
      if (parentSuspense.deps === 0) {
        parentSuspense.resolve()
      }
    }
  }

  const unmountChildren: UnmountChildrenFn = (
    children,
    parentComponent,
    parentSuspense,
    doRemove = false,
    start = 0
  ) => {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], parentComponent, parentSuspense, doRemove)
    }
  }

  const getNextHostNode: NextFn = vnode => {
    if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      return getNextHostNode(vnode.component!.subTree)
    }
    if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return vnode.suspense!.next()
    }
    return hostNextSibling((vnode.anchor || vnode.el)!)
  }

  const setRef = (
    rawRef: VNodeNormalizedRef,
    oldRawRef: VNodeNormalizedRef | null,
    parent: ComponentInternalInstance,
    value: RendererNode | ComponentPublicInstance | null
  ) => {
    const [owner, ref] = rawRef
    if (__DEV__ && !owner) {
      warn(
        `Missing ref owner context. ref cannot be used on hoisted vnodes. ` +
          `A vnode with ref must be created inside the render function.`
      )
      return
    }
    const oldRef = oldRawRef && oldRawRef[1]
    const refs = owner.refs === EMPTY_OBJ ? (owner.refs = {}) : owner.refs
    const setupState = owner.setupState

    // unset old ref
    if (oldRef != null && oldRef !== ref) {
      if (isString(oldRef)) {
        refs[oldRef] = null
        if (hasOwn(setupState, oldRef)) {
          setupState[oldRef] = null
        }
      } else if (isRef(oldRef)) {
        oldRef.value = null
      }
    }

    if (isString(ref)) {
      refs[ref] = value
      if (hasOwn(setupState, ref)) {
        setupState[ref] = value
      }
    } else if (isRef(ref)) {
      ref.value = value
    } else if (isFunction(ref)) {
      callWithErrorHandling(ref, parent, ErrorCodes.FUNCTION_REF, [value, refs])
    } else if (__DEV__) {
      warn('Invalid template ref type:', value, `(${typeof value})`)
    }
  }

  /**
   * @desc 如果它的第一个参数 vnode 为空，则执行销毁组件的逻辑，否则执行创建或者更新组件的逻辑。
   * @param vnode 虚拟dom
   * @param container 挂载的根组件
   */
  const render: RootRenderFunction = (vnode, container) => {
    if (vnode == null) {
      // 销毁组件
      if (container._vnode) {
        unmount(container._vnode, null, null, true)
      }
    } else {
      // 创建或者更新组件
      patch(container._vnode || null, vnode, container)
    }
    flushPostFlushCbs()
    // 缓存vnode节点， 表示已经渲染
    container._vnode = vnode
  }

  const internals: RendererInternals = {
    p: patch,
    um: unmount,
    m: move,
    r: remove,
    mt: mountComponent,
    mc: mountChildren,
    pc: patchChildren,
    pbc: patchBlockChildren,
    n: getNextHostNode,
    o: options
  }

  let hydrate: ReturnType<typeof createHydrationFunctions>[0] | undefined
  let hydrateNode: ReturnType<typeof createHydrationFunctions>[1] | undefined
  if (createHydrationFns) {
    ;[hydrate, hydrateNode] = createHydrationFns(internals as RendererInternals<
      Node,
      Element
    >)
  }

  return {
    render,
    hydrate,
    createApp: createAppAPI(render, hydrate)
  }
}

export function invokeVNodeHook(
  hook: VNodeHook,
  instance: ComponentInternalInstance | null,
  vnode: VNode,
  prevVNode: VNode | null = null
) {
  callWithAsyncErrorHandling(hook, instance, ErrorCodes.VNODE_HOOK, [
    vnode,
    prevVNode
  ])
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        p[i] = j
        result.push(i)
        continue
      }
      u = 0
      v = result.length - 1
      while (u < v) {
        c = ((u + v) / 2) | 0
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
